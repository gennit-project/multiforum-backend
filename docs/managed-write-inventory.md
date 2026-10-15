# Managed write transaction inventory

This inventory records the business-write audit from issue
[#310](https://github.com/gennit-project/multiforum-backend/issues/310). A
managed transaction callback can run more than once, so callbacks contain only
database work and return consumed/plain values. Email, plugin triggers, and
object-storage calls run after or outside the retryable callback.

## Prioritized multi-step mutations

The following user-visible operations are managed transaction units:

| Operation | Transaction boundary | Post-commit work |
| --- | --- | --- |
| Create an event with channels | Event OGM create and all `EventChannel` writes | Refetch only |
| Create an event series | Series/occurrence OGM create and every occurrence-channel write | Refetch only |
| Update an event | Event OGM update and all channel connects/disconnects | Version history, email, and in-app notification |
| Update an event series | All affected occurrence/series OGM updates and current-event channel changes | Email and in-app notification |
| Update a discussion | Discussion OGM update, attached-file age-gate stamp, album disconnections, and all channel changes | Version history and plugin triggers |
| Track a download | Counter, ownership, subscription, and automatic collection changes | None |
| Permanently remove stored media | Final graph marker/reference clearing and audit relationships/properties | Object deletion happens before this transaction |

Event and discussion version-history handlers receive a pre-update snapshot and
run once after the core transaction commits. They are intentionally best-effort
audit work rather than part of a retryable callback. Plugin triggers and email
likewise stay outside the callback.

Storage deletion is idempotent: Google Cloud Storage deletion uses
`ignoreNotFound: true`. The object is deleted before the final graph write and
is never deleted from inside a managed callback. If the final graph write
fails, retrying the mutation safely repeats the no-op object deletion and then
retries the graph marker/reference update. This is the recovery boundary until
a durable cross-system outbox is introduced.

## Deliberate remaining `session.run` calls

The remaining calls fall into these audited categories:

- Read-only lookups: the authorization/metadata reads in
  `permanentlyDeleteStoredUpload.ts`, `permanentlyDeleteUrlBackedImage.ts`,
  `updateDownloadableFileSupportSettings.ts`, `sensitiveContentAccess.ts`, and
  `sensitiveContentTarget.ts`, plus `neo4jSchemaAudit.ts`.
- Single-statement mutations: subscription toggles, wiki-page pins, collection
  ordering, album-image reuse, birthday/profile settings, downloadable-file
  scan/support settings, and revision redaction. Each call is one atomic Cypher
  statement, so it cannot partially commit within Neo4j. They remain candidates
  for managed retries, but were lower risk than the multi-statement boundaries
  above.
- Post-commit notifications: the shared `inAppNotifications.ts` writer,
  mention hooks, and lock/unlock notification writes.
  Moving these to `executeWrite` alone would not make a notification
  semantically idempotent across a caller retry. They need a stable event key or
  outbox before automatic retry is enabled.
- Startup, migration, maintenance, and test tooling:
  `filterGroupUploadSelection.ts`, `uploadStorageMetadata.ts`,
  `channelRoleOwnershipMigration.ts`, age-gate/index/constraint setup,
  `seedDataForCypressTests.ts`, and `dropDataForCypressTests.ts`. Schema
  statements and intentionally independent migration/test batches are not
  request-time business transaction units.

When one of the single-statement mutations grows a second dependent write, move
the entire unit into one `executeWrite` callback rather than adding another
auto-commit call.
