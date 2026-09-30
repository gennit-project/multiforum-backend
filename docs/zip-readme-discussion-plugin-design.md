# ZIP README discussion plugin

Status: **Draft proposal — no implementation in this PR.**

## Purpose and user experience

When someone uploads a ZIP containing a README, readers should see that README
as rendered Markdown in the related discussion's default view. They should not
have to download and unpack the archive to discover what it contains. This
borrows the useful behavior of a GitHub repository's default page.

Proposed plugin ID: `zip-readme-discussion`.

For the first release, an enabled channel pipeline copies the selected README's
Markdown into an **empty discussion body**. The ordinary discussion renderer
then displays it. We store Markdown, not generated HTML. An author-written body
always wins; existing text is never silently replaced or appended to.

Example: an author uploads `widget.zip`, containing `widget/README.md`, and
leaves the discussion body blank. After required security checks and the plugin
finish, the default discussion view shows the README's introduction, headings,
lists, and code blocks. A small attribution links to the archive and the plugin
source. The pipeline view explains where the content came from. If the author
entered a description, it remains unchanged and the plugin reports a skip.

This is optional enrichment. A missing README does not make a download unsafe
or prevent publishing. Separate security policies retain their own enforcement.

## Current implementation and source references

The backend references below are pinned to the inspected base commit
`933f4f29e57f032383417f9b050626be1a65bcb1`:

- [Discussion creation and pipeline ordering](https://github.com/gennit-project/multiforum-backend/blob/933f4f29e57f032383417f9b050626be1a65bcb1/customResolvers/mutations/createDiscussionWithChannelConnections.ts): runs server `downloadableFile.created` checks before channel `discussionChannel.created` pipelines.
- [Channel plugin runtime](https://github.com/gennit-project/multiforum-backend/blob/933f4f29e57f032383417f9b050626be1a65bcb1/services/plugin/channelTrigger.ts): supplies `discussionId`, `discussionBody`, `downloadableFileId`, filename, size, and signed `attachmentUrls`. Its context supports logging, diagnostics, and flags, but no discussion-body write capability. Plugin results are recorded, not applied as body edits.
- [Storage read URL helper](https://github.com/gennit-project/multiforum-backend/blob/933f4f29e57f032383417f9b050626be1a65bcb1/services/downloadStorage.ts): existing integration point for reading stored attachments.
- [Plugin package README handling](https://github.com/gennit-project/multiforum-backend/blob/933f4f29e57f032383417f9b050626be1a65bcb1/customResolvers/mutations/shared/pluginManifest.ts): reads a declared README from an installed plugin's tarball. It is a separate feature, not a ZIP attachment reader.
- [Public diagnostic contract](https://github.com/gennit-project/multiforum-backend/blob/933f4f29e57f032383417f9b050626be1a65bcb1/services/plugin/publicDiagnostics.ts): reference for safe, structured pipeline messages.
- [Hello World plugin source](https://github.com/gennit-project/multiforum-plugin-hello-world/blob/main/index.ts): real reference implementation of the constructor/context and `handleEvent` pattern. Its event declarations must be adapted for this plugin.
- [Attachment scan plugin manifest](https://github.com/gennit-project/multiforum-plugin-security-attachment-scan/blob/main/plugin.json): real reference for `source.repoUrl`, `documentation.readmePath`, version compatibility, and settings. Its README-presence policy does not copy content into discussions.

The new plugin does not exist yet. Proposed implementation home:
`gennit-project/multiforum-plugin-zip-readme-discussion`, with `index.ts`,
`plugin.json`, `README.md`, and extraction tests. This is a proposed repository
name, not a claim that a source URL is already available. Before release, create
the repository, populate `source.repoUrl` with its actual URL, and update this
document with a commit-pinned link to `index.ts`. The existing links above are
reference code, not the source of an already implemented README plugin.

## Scope and activation

- Server administrators install and enable the plugin; channel owners explicitly
  add it to their `discussionChannel.created` pipeline.
- MVP handles one ZIP attached to the discussion, as exposed by the current
  channel event payload. Non-ZIP attachments are skipped.
- Channel configuration clearly states that enabling it allows automatic filling
  of empty discussion bodies. For cross-posts, the body is shared: enabling this
  in one channel can affect every view of the same discussion. Show that effect
  in configuration help, and serialize application per discussion.
- No new tab is needed. Verify the frontend actually displays the populated
  body in its default discussion/download view; adjust that view if necessary.
- No automatic refresh, overwrite, arbitrary archive browsing, nested ZIP
  extraction, AI rewriting, or historical backfill in the first release.
  Replacement ZIPs do not silently rewrite an already imported body.

## Proposed execution flow

1. Run the existing server security pipeline before channel enrichment. Ordering
   alone is insufficient: inspect current policy and the exact file version's
   scan outcome. Pending, failed, suspicious, infected, or otherwise quarantined
   files must not be read or imported. If no scan is required, use the normal
   attachment-access policy. Never mark a file clean from this plugin.
2. Capture the discussion body revision and the immutable attachment identity
   before extraction. Extend the current envelope with a server-derived version
   identity; filename and file ID alone cannot distinguish replacement bytes.
3. Read the ZIP through a bounded, host-provided reader restricted to that
   attachment. The plugin never chooses a fetch URL. Use private storage access
   internally; do not persist signed URLs in bodies, provenance, or diagnostics.
4. Enumerate validated ZIP entries, choose one README deterministically, and
   decode only that entry. Do not extract files onto disk or execute archive
   content. README text is data, never agent instructions.
5. Submit the Markdown and selected path to a new host capability scoped to the
   current invocation. The host constructs attribution from trusted metadata and
   atomically applies the body only if the eligibility checks still hold.
6. Record provenance and a public diagnostic. Refresh/invalidate the discussion
   query after completion so readers see the result without navigating to another
   tab. A transient read failure can be retried through existing pipeline controls.

## README discovery and archive limits

All numbers here are proposed defaults to validate with representative uploads.
Administrators may lower them; channel settings cannot raise server limits.

| Rule | MVP behavior |
| --- | --- |
| Supported names | Case-insensitive `README.md`, `README.markdown`, `README.txt`, `README`, in that priority order. |
| Location | Archive root first; otherwise the sole top-level wrapper directory, supporting repository-style ZIPs. Ignore `__MACOSX` metadata. Do not search arbitrary subdirectories. |
| Ambiguity | Multiple candidates at the same priority, duplicate normalized paths, or case-colliding names cause a safe skip; do not depend on ZIP entry order. |
| Format | UTF-8, optional BOM. Normalize line endings. Reject invalid encoding and NUL-containing content. Render `.txt` and extensionless files as escaped plain text using a safe fence longer than any contained backtick run. |
| Download budget | At most 50 MiB of compressed bytes, enforced while reading even when size metadata is absent or false. |
| Index budget | At most 10,000 entries and 4 MiB of directory metadata. |
| Content budget | At most 256 KiB of actual decompressed README bytes, within the discussion body's own limit including attribution. Never silently truncate. |
| Expansion budget | Selected entry compression ratio at most 100:1; enforce streaming byte limits independently of advertised sizes. |
| Time budget | 15 seconds for fetching and parsing, with cancellation and resource cleanup. |

Reject absolute paths, drive-prefixed paths, traversal components, NULs, symlink
entries, encrypted archives, unsupported compression, malformed directories, and
CRC mismatches. Define path normalization before selection, including backslash
handling. Limits must be enforced during parsing/decompression, not just against
untrusted ZIP headers. Large archives skip enrichment without bypassing security
checks or changing existing download policy.

## Safe body application and provenance

Proposed host capability (not an existing API):
`context.discussion.applyReadmeIfEmpty({ markdown, readmePath })`.
The bound host context supplies the target discussion, plugin identity/version,
channel, pipeline run, body revision, and attachment version. Plugins cannot
provide a different target ID or obtain general database write access.

The backend validates payload type and size and performs a single atomic
operation that checks:

- this exact plugin and channel pipeline remain enabled and authorized;
- the discussion still belongs to that channel and references the same file
  version, with readable/non-quarantined status under current policy;
- the body is still null, empty, or whitespace-only, and its revision matches the
  captured revision; a concurrent author edit wins;
- no import has already been applied to this discussion/file version.

Persist the body, normal edit-history/audit effects, and the import record in the
same transaction. Add a monotonic body revision if the existing edit model
cannot reliably detect concurrent changes; all body-writing paths must advance
it. Do not rely on a read-then-write check outside the transaction.

The import record contains discussion ID, attachment version, selected README
path, content digest, plugin ID/version, pipeline run ID, applied body revision,
and timestamp. A uniqueness constraint on discussion plus attachment version
prevents retries and cross-post channel runs from applying duplicate imports.
Concurrent runs with different extraction settings cannot race to append text.
Public fields inherit discussion visibility; no private storage locations leak.

On retry after a successful transaction but failed job-status update, return
`ALREADY_IMPORTED` without another edit. If an author subsequently edits or
clears the generated body, preserve that action and keep the import record so
retries do not repopulate it. A future explicit re-import action is separate.

Attribution follows the imported text, for example:

> Imported from `widget/README.md` in [widget.zip](ARCHIVE_PAGE_URL) by [ZIP README plugin](VERIFIED_PLUGIN_SOURCE_URL).

These uppercase values are illustrative placeholders. The host uses a stable,
authorized application download-page link, never a signed object URL. The source
link comes from the installed version's validated `source.repoUrl`, preferably
pinned to the released commit; it is not inferred from archive contents. An
installed release must provide a valid HTTPS source URL before activation.

## Rendering and links

Use the discussion's existing Markdown rendering policy and verify sanitization
with hostile fixtures. Raw HTML, scripts, dangerous URI schemes, and event
handlers must not become executable. Apply the same policy in previews and the
default view; do not trust extracted content because it came from a scanned ZIP.

Absolute safe HTTPS links and local heading anchors can remain links. MVP does
not publish files embedded in the ZIP: convert relative file links to readable
labels with their paths, and images to alt text plus paths/URLs. This avoids
broken relative links, automatic remote-image tracking, and accidental disclosure
of archived assets. Use a Markdown parser, not regular expressions, to transform
links without damaging code blocks. Treat protocol-relative and unsafe URLs as
text. Explain this limitation in the plugin README.

## Outcomes, retries, and rollout

Use stable public codes such as `README_IMPORTED`, `README_NOT_FOUND`,
`README_BODY_NOT_EMPTY`, `README_ALREADY_IMPORTED`, `README_AMBIGUOUS`,
`README_UNSUPPORTED`, `README_LIMIT_EXCEEDED`, `README_SECURITY_BLOCKED`,
`README_STALE_INPUT`, and `README_READ_FAILED`. These codes are proposed. Publish
safe summaries and selected paths only; never README excerpts or signed URLs.

Expected no-ops report successful execution with a skip diagnostic. Transient
storage/network failures report failure and allow an eligible retry. Invalid
archives and deterministic limit failures explain that replacement is needed.
Enrichment failure must not mutate malware status or independently quarantine a
download. Verify that attempt-status aggregation and the frontend honor this
distinction before exposing the plugin as a selectable step.

Ship the host capability and versioned invocation contract first, then the plugin
and registry entry with compatible minimum server version. Pilot in one opt-in
channel. Track imports, skip reasons, failures, processing time, and bytes read
without recording content. Disabling the pipeline stops future imports; existing
body text remains editable and is not destructively rolled back on uninstall.

## Acceptance and implementation tests

1. Root README and single wrapper-directory README populate an empty body and
   appear as rendered Markdown in the default view, with working source and
   archive links. Test public and restricted discussions with their normal access.
2. Author content, concurrent edits, deleted discussions, detached attachments,
   replaced file versions, and revoked configuration prevent application.
3. Duplicate delivery, concurrent cross-post runs, and retry after commit produce
   one import and one audit entry. Clearing an imported body does not refill it.
4. Missing, ambiguous, malformed, encrypted, oversized, traversal, symlink,
   high-ratio, bad-encoding, and bad-CRC fixtures have bounded resource use and
   do not alter the body. Test limits against misleading archive metadata.
5. Pending/failed scan outcomes prevent import even if the server pipeline
   returned normally. Recheck file status and version immediately before commit.
6. Markdown fixtures cover scripts, HTML, unsafe URLs, relative assets, fences,
   headings, and remote images. No signed URLs or private paths appear publicly.
7. A nonessential extraction failure leaves the discussion usable and preserves
   the security pipeline's download decision. Disabling the plugin prevents new
   writes without removing previously imported text.

Implementation PRs should target at least 80% coverage for new code, or the
repository's higher configured gate. Cover the extractor with adversarial unit
fixtures, the atomic application with database integration tests, and the default
view with an end-to-end test. This design-only PR introduces no runtime code.

## Review decisions

The proposed MVP chooses empty-body-only import, opt-in channel activation,
one-time application, and text-only archive asset handling. Reviewers should
confirm the shared-body behavior for cross-posted discussions and the proposed
archive limits before implementation. Automatic refresh and importing alongside
author text can be considered later with explicit ownership and edit semantics.
