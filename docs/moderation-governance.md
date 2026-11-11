# Moderation governance (#433 / frontend #720)

## Contract

`llm-moderation` version 0.8.0 adds flat server settings:

- `serverRuleEnforcement`: `on` or `off`. When on, every supported content event
  retains a mandatory server-selected moderation step, regardless of a channel
  pipeline's omission, condition, failure order or older version pin.
- `channelRuleEligibility`: `all`, `none` or `allowlist`.
- `channelRuleAllowlist`: an array of case-sensitive channel unique names.

The latest server-enabled installation owns governance policy. A compatible
server pipeline version may still select execution code. Channel settings never
supply policy. New policy must not be sent to published 0.7.1; the coordinated
0.8.0 artifact must be released and installed first. There is no deployment in
this change.

Owner API: `getChannelRuleGovernance`, `setChannelRuleEnforcement` and
`requestChannelRuleEnforcement`, all scoped to an owned channel. Owner opt-in is
stored on the channel's ENABLED relationship. It does not enable global rules.
Generated mutation paths, including deeply nested Channel inputs beneath other
roots, cannot alter moderation opt-in. The schema-aware guard rechecks each
aliased mutation separately, and leaves JSON scalar data opaque;
ordinary plugin paths continue to work. Runtime eligibility is checked again,
including queued execution, rather than trusting an existing enabled edge.

Requests are server-scoped Issues (`channelUniqueName: null`) with
`requestKind: CHANNEL_RULE_ENFORCEMENT`, `requestedPluginId: llm-moderation` and
`relatedChannelUniqueName` identifying the target. Those discriminator fields,
approval time and approver are not generated-mutation writable. A server admin
with `canManagePlugins` calls `approveChannelRuleEnforcement(issueId)`.
The authenticated `getPluginManagementCapability` query exposes the effective
capability (root, role tier and suspension), without sending suspension notices
or cleaning up expired suspensions merely because someone views a request.
Approval adds eligibility and closes the request; the owner must still opt in.
Open requests and successful approval retries are idempotent. Approval checks
that the channel exists and the current policy is still allowlist.

## Reconciliation and concurrency

Request creation, approval and owner toggles serialize on the server node.
Declarative reconciliation unions the live channel-rule allowlist with the
manifest's desired list. It reads and preserves the newest approvals under the
same server lock at write time, so an approval between preview and apply is not
lost. Across a version activation, approvals come from the latest currently
enabled installation, not from stale settings on the target version.
Declarative applies activate replacements before retiring old moderation versions,
independent of manifest order; an activation failure leaves the old governor
enabled. Retiring a higher governor transfers its latest grants to a compatible
lower successor in the same transaction, covering approvals during a fallback. Explicit admin plugin settings are the place to revoke an allowlist entry;
manifest omission does not revoke it. No legacy server-rule allowlist is reused
as a channel-rule allowlist.

## Migration decision and rollout gate

Legacy `off`, `all_forums` and `allowlist` retain their exact runtime behavior
through upgrade. Settings carry-over retains the legacy keys rather than
silently introducing new defaults. After installation, an admin explicitly
selects the new global toggle and channel eligibility policy. In particular,
legacy `allowlist` cannot be mapped to either new global choice without changing
scope. The status API exposes `migrationRequired` and `legacy_allowlist` so the
frontend asks for that decision.

The production template targets 0.8.0 and requires
`--server-rule-enforcement on|off` when rendering; it does not choose for an
operator. The trial channel list is explicitly channel eligibility only.

Before enabling the new global toggle, finish or cancel/drain moderation jobs
queued under the old pipeline topology. Existing jobs keep their persisted run
ordering/version for identity consistency; incompatible old plugin versions are
skipped rather than run with new settings. Fresh queues always retain the new
mandatory global step. Real Neo4j concurrency and end-to-end browser validation
remain rollout gates, not implied by unit tests.

## Mandatory reports and bot suspensions

A channel-local suspension cannot veto reports citing the canonical server rules
when global enforcement is on. Mixed reports are reduced to their server-rule
citations with a neutral review request; channel judgments and recommendations
are not carried through that exception. Channel-only reports, ordinary bots,
legacy/off policy and bot comments keep their existing local suspension behavior.
Server-scoped bot suspensions still block mandatory reports, including indefinite
suspensions. Missing server identity or failed suspension lookups fail closed.
