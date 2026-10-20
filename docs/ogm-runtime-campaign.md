# OGM runtime removal campaign — issue #284

## Authorization and checkpoint

One NEW cumulative draft PR targeting main, separate reviewed commits per slice/subdivision. PR #353 is already merged and must not be reused. User approved the complete plan and mixed approach: focused driver repositories for finite operations, named operations through the supported existing generated GraphQL schema API for arbitrary generated inputs. No generic replacement OGM facade.

First checkpoint: zero production runtime OGM usage, plus CLI and wiring cleanup. Type/codegen/package removal is a separate proposed checkpoint. No merge, deployment, production data access, credential/access changes or major dependency upgrades authorized. Duplicate event suppression is authorized ONLY for creator moderator assignment.

## Baseline and accounting

Reverified 2026-10-20: origin/main is `006f625477cdd32be2e3a7ec3ea14c649da17638`; no delta from audited baseline. Clean starting tree. Open PR search found only dependency-major #253 and documentation #317/#318, no competing migration PR.

- 478 domain CRUD sites in 155 production files: 272 find / 146 update / 52 create / 8 delete. Areas: customResolvers 337, services 82, hooks 34, middleware 19, rules 6.
- 74 literal model acquisitions in 22 files; including optional chaining, 98 in 32 files. These overlap CRUD consumers and are NOT added to 478.
- resolverDeps has 34 acquisitions. Issue identity proxy has two forwards, generic repository four forwards: delegates, not extra domain sites.
- Two separate CLI CRUD sites in build_scripts/migrateLegacyPluginPipelines.ts plus its initialization.
- 171 generated-type importers, 158 model/model-map type importers, 14 runtime-enum consumers overlap the runtime inventory; they are not additional runtime operations.
- seedDataForCypressTests is production-wired and included. Zero-call model injection/pass-through consumers must also be removed.

`ogm-runtime-baseline.json` records every audited domain call by baseline location. `ogm-runtime-campaign.json` is the recoverable scope/status ledger. Baseline line numbers do not track subsequent edits. Count removed calls against the original sites; rerun runtime/acquisition searches before declaring completion.

## Behavior and acceptance gates

Preserve fail-closed authorization, accepted inputs, first-error contracts, selection defaults, serialization, actual routing/database selection/bookmarks, transaction ownership, retry boundaries, side effects, event counts/payloads/order, generated defaults and age-gate reconciliation. Do not introduce READ routing where absent. Preserve existing managed READ calls where characterized, rather than blanket-changing them. Existing leader-routed repositories remain leader-routed.

Named schema operations must preserve parse/validation/coercion and the original underlying schema/context semantics; do not automatically pass outer auth context or use the Shield-wrapped schema. Characterize publication inside externally owned transactions before changing those writers. Preserve Issue identity/mirrors and allocation boundaries. No opportunistic atomicity, dedupe, outbox or race-behavior redesign.

Each slice: characterize old behavior; run meaningful unit and live disposable Neo4j parity tests; mock external storage/email/network/runners; verify graph and events for writes and rollback/failure boundaries for transactions; obtain independent diff review and resolve findings; commit separately with exact verification evidence. At checkpoints run cumulative units/types/build/lint/circular checks and inspect exact-SHA CI. Final checkpoint additionally requires all integration shards, performance and required coverage gates. Report passed/failed/unrun checks accurately.

## Ordering and parallelism

Start 01,02,04. Then notifications 05–06, filter guards 07–10 and plugin reads 35. Independent small writes 03,11–17 follow their contracts. Issue foundation 18–19 precedes history 20–23, reports/moderation 24–30 and bot reports 39. Producers 31–33 follow history; retain collection/seed adapters until producers land. Plugin configuration 37 secrets precedes 36 installation; 38 bot identity follows account contracts. Lease/attempt contracts 40 and notification claims 44 precede triggers 41–43; controls 44 follow triggers; campaigns 45 follow controls. Seed endpoint 46 follows composed creators.

Unrelated read/member/entity slices may be developed independently after shared contracts stabilize. One integration owner for schema executor, publisher, factory and startup. Sequential integration for plugin state transitions and trigger/control/campaign chain. Each multi-commit package explicitly retains its subdivisions below.

## Slice ledger

Rows track the current campaign state. A slice is complete only with independent review, commit and verification evidence; edits alone are not completion. See JSON for concrete full file paths.

| ID / scope | CRUD sites | Dependencies | Specific acceptance / subdivisions | Status |
|---|---:|---|---|---|
| 01 Age policy/setup | 2 | None; first implementation slice | Missing/default policy, cache, absent config and setup flags | complete |
| 02 Contribution reads | 4 | 01 age-policy interface when applicable | Missing identity, date ranges, counts, errors and session closure | complete |
| 03 Account/email | 7 | 01; write/event parity | Ownership, normalization, duplicate account/email and nested creation | pending |
| 04 Subscription target reads | 10 | None; preserve existing raw writes | Missing targets, repeats, selected response parity; no new events | complete |
| 05 Notification snapshots | 8 | 01 where age filtering applies | Recipients/preferences/actor exclusions; email-before-in-app ordering | complete; a07af6a |
| 06 Notification creation | 1 | 05; shared publisher contract | Nested notification graph/events and caught-error boolean contract | pending |
| 07 Role filter guards | 4 | Named-schema operation contract | Arbitrary/nested filters; missing/multiple-owner fail-closed authorization | reviewed; exact-tree gates pending |
| 08 Wiki filter guards | 2 | Named-schema operation contract | Locked pages, arbitrary filters and unique channel ownership | pending |
| 09 Content validation | 4 | Named-schema operation contract; 01 | Existing-file/filename fallback, filters, preferences and exact errors | pending |
| 10 Collections | 4 | Named-schema operation contract; retain creation adapter until 31 | Filter merge precedence, visibility, sensitivity and default sorting | pending |
| 11 Forum membership | 16 | 06; write/event contract | Split moderator vs owner/admin; sequential-write partial failures and event counts | pending |
| 12 Server membership | 13 | 06; write/event contract | Split admin vs moderator; repeat acceptance, partial failures and events | pending |
| 13 Reactions/sticky | 6 | Write/event contract | Actor checks, repeated reactions/removals and sticky order | pending |
| 14 Votes | 14 | Write/event contract; retain raw vote ordering | Split comment/discussion/supervote; weights, author unions, karma and race behavior | pending |
| 15 Scratchpad | 7 | Write/event contract | Ownership, visibility, missing entries and relationship cleanup | pending |
| 16 Image creation/profile | 4 | Storage mocks; write/event contract | Variant/upload/database ordering and failures, all external IO mocked | pending |
| 17 Wiki actions | 8 | 08; write/event contract | Permissions, channel scope, ordering and relationship events | pending |
| 18 Issue target/identity | 9 | Issue identity and allocation characterization | Every target kind; mirrors, immutable identity and allocation boundaries | pending |
| 19 Issue activity/lock | 11 | 18; 05–06 | Actor/activity references, lock transitions and notification order | pending |
| 20 Comment revisions | 6 | 18–19 | Snapshots, deduplication, authors, revision refs and ageGateTouchedAt | pending |
| 21 Discussion revisions | 12 | 18–19 | Title/body/no-op updates, recent-version dedupe and revision refs | pending |
| 22 Event revisions | 9 | 18–19 | Event-specific snapshots/defaults; no unsupported repository reuse | pending |
| 23 Wiki revisions/redaction | 9 | 18–19; 08 | Separate revision/redaction commits; visibility, authors and redaction authorization | pending |
| 24 Content reports | 17 | 18–19; 05–06 | Separate entity commits; existing reports, numbering, activity and notifications | pending |
| 25 Image/profile/wiki reports | 17 | 18–19; 05–06; 23 for wiki | Separate image-family/wiki commits; owner vs target and replaced images | pending |
| 26 Channel moderation | 9 | 18–19; 05–06 | Repeated actions, moderation state, activity and recipients | pending |
| 27 Comment moderation | 11 | 18–20; 05–06 | Archive metadata, history, issue effects and notifications | pending |
| 28 Discussion/event moderation | 18 | 18–19,21–22; 05–06 | Split discussion 9/event 9; entity-specific history and notifications | pending |
| 29 Image moderation/removal | 17 | 18–19; 05–06; storage mocks | Split archive pair 11/permanent removal 6; storage failure windows | pending |
| 30 Suspensions | 7 | 18–19; 05–06 | All user/mod wrappers, scope, duration, authorization and activity | pending |
| 31 Discussion create/update | 6 | 21; 05–06; closes 10 adapter | Connections, explicit transaction propagation, rollback and history | pending |
| 32 Event create/update | 5 | 22; 05–06; external transaction/event gate | Explicit transaction/event timing, rollback and connections | pending |
| 33 Event recurrence | 19 | 32; external transaction/event gate | Three commits: create 2/update 9/delete 8; recurrence scope and independent deletes | pending |
| 34 Download review/labels | 14 | Retain pipeline adapter until 41/44 controls | Split review/preparation 7/labels 7; scan state and label history | pending |
| 35 Plugin read models | 20 | 01; visibility/redaction contract | Split configuration vs run/visibility reads; redaction, order and empty states | pending |
| 36 Plugin registry/install | 22 | 37 secrets before install; external IO mocks | Two commits refresh 13/install 9; verification/download/write/rename failure ordering | pending |
| 37 Plugin config/secrets | 16 | 35; configuration/secret masking contract | Three commits secrets 5/server 6/channel 5; masking, rename, inheritance and auth | pending |
| 38 Bot identity/comments | 13 | 03; write/event contract | Nested identity creation, activation/deprecation, channel links and comment context | pending |
| 39 Bot reports | 6 | 18–19; 38 | Issue identity, report deduplication and actor attribution | pending |
| 40 Pipeline leases/attempts | 14 | Lease/attempt state characterization; 44 notifications before dependent consumers | Separate lease 6/attempt 4/watchdog 4; competing claims, stale leases, heartbeat, timeouts | pending |
| 41 Pipeline download execution | 12 | 40; 44 notifications; 34 as applicable | Runner side effects outside retried callbacks; statuses/retries/results | pending |
| 42 Pipeline channel execution | 13 | 40; 44 notifications; 38 | Channel applicability, bots, statuses and execution failure ordering | pending |
| 43 Pipeline comment execution | 11 | 40; 44 notifications; 38 | Comment applicability, recursion guards, middleware wiring and ordering | pending |
| 44 Pipeline control/notifications | 18 | Notifications before 40–43; controls after 41–43 and 34 | Notifications 4 first, controls 14 later; conditional claim failure windows and retry eligibility | pending |
| 45 Pipeline campaigns | 14 | 40–44 | Progress, cancellation, aggregation and restart behavior | pending |
| 46 Test seeding endpoint | 9 | 31–33 and other reused creation helpers | Access restrictions, fixture relationships and composed responses | pending |

## Runtime closure slices (after domain consumers)

- CLI: migrate two legacy plugin pipeline operations and standalone OGM initialization; disposable fixture tests only, never run a real migration.
- Wiring: remove acquisition/injection from resolver factories, background jobs, notification subscription context and middleware, including zero-call consumers such as configuration orchestration.
- Wrappers: remove repository forwards/Issue proxy after protections are owned by new boundaries.
- Startup: remove runtime OGM adapter and private initializeOgmFromExistingSchema bridge; verify startup, background jobs, subscriptions and container smoke.

This is bounded integration cleanup, not a catch-all for remaining domain work.

## Later type/package phase

Assess after runtime closure; do not silently include it in this checkpoint. Replace generated model interfaces as owners migrate, but preserve public input/output contracts and runtime enum values. Only remove OGM dependency after CLI, fixtures and build_scripts/generateTypes.ts no longer need it. GraphQL 7 and Driver 6 remain separate later work.

## Stop conditions

Pause the affected chain for unresolved filter compatibility, external-transaction event timing, changed atomicity/retry/notification semantics, schema/major-upgrade requirements, production credentials/data requirements or failures outside scope. Continue other independent authorized slices. User already approved hybrid execution and runtime-first checkpoint; do not ask again. New concrete behavior discrepancies require explicit decisions.

## Verification and review evidence

Baseline evidence predates this campaign: prior local 1,867 units / 452 integrations passed; merged-main Tests CI run 39427029177 and container run 39427029068 passed. Not a substitute for new exact-head checks.

Reviewed implementation evidence follows. Record each commit's scope, comparison link, commands/results, reviewer and resolved findings here. Later ledger commits may record the preceding tested SHA to avoid self-referential hashes.

### Slice 01 — age/setup reads

Removed two CRUD sites and one model acquisition (476 runtime sites / 97 acquisitions remain). Named policy/setup repository replaces injected OGM reads through the cache and caller graph. Independent reviewer `review_slice1` approved after nullable serverName, legacy numeric coercion and required prepareDownload dependency corrections. Targeted units 64/64 and live shared-production-schema parity 11/11 passed; all external resources disposable. Cumulative TypeScript passed. Exact commit and committed-tree verification follow in the next ledger update.

The ledger setup commit's hook also runs lint, TypeScript and full units; this validates the working tree, not a claim that the ledger-only commit contains implementation.

### Slice 01 committed evidence

Commit `ff70e15aa4f07dbfae2d7baa3e0ab0729be7b1e4` ([diff](https://github.com/gennit-project/multiforum-backend/commit/ff70e15aa4f07dbfae2d7baa3e0ab0729be7b1e4)). Isolated checkout of that exact commit passed TypeScript, 64 focused units and 11 live production-schema parity tests. Tests use Node26/pnpm10 and disposable Neo4j; child environment excludes application credentials/configuration.

### Slice 02 — contribution identity reads

Removed four CRUD sites (472 remain). Managed READ target existence checks remain separate from existing aggregation sessions. Independent `review_contributions` approved; baseline live11/11, migrated units23/23 and live13/13 passed. The four obsolete model arguments were removed from factory wiring. Exact commit evidence follows in next ledger update.

### Slice 02 committed evidence

Commit `021f3a0d86c07b033587fef752e9a081f623879a` ([diff](https://github.com/gennit-project/multiforum-backend/commit/021f3a0d86c07b033587fef752e9a081f623879a)). Exact committed source tree passed TypeScript, 23 targeted units and 13 live tests (production-schema parity plus existing contribution integration coverage).

### Slice 04 — subscription response reads

Removed 10 CRUD sites (462 remain in 139 files; acquisitions remain 97). Existing raw writes and their event behavior are unchanged. Independent `review_subscription` approved after preserving legacy numerical/ID/array and APOC temporal transformations. Targeted units 22/22 and live production-schema parity 27/27 passed, including repeated actual resolver operations. Exact commit evidence follows in next ledger update.

### Slice 04 committed evidence

Commit `776e0847d5f52f8e5ba8bd88a8e177c87e4ccca1` ([diff](https://github.com/gennit-project/multiforum-backend/commit/776e0847d5f52f8e5ba8bd88a8e177c87e4ccca1)). Exact source tree passed TypeScript, 22 focused units, 27 live tests, build and circular-dependency checks. Cumulative hook lint/TypeScript and 1,912 unit tests passed. Published with slices01/02 in draft PR #354.

### Foundation F01 — supported schema execution

Explicitly register the unwrapped production schema by driver before applying middleware. Named domain documents use supported graphql() parsing/validation/coercion and original default context/root/first-error semantics. No generic model API, request-auth inheritance or production OGM introspection. Independent reviewer review_slice1 approved; 5 unit and 4 live parity tests passed. No domain CRUD count reduction. This initial executor does not accept executionContext/custom rootValue; those migrations require separate characterization and reviewed extension.

### Test execution environment

Checks use Node26/pnpm10 with an infrastructure-only child environment (HOME/USER/LOGNAME/SHELL/TMPDIR/LANG/LC_ALL/TERM/CI/Docker connection variables plus pinned PATH, TS_NODE_TRANSPILE_ONLY=true, TESTCONTAINERS_REUSE_ENABLE=false). Application configuration and credentials are excluded. An initial unsanitized unit run failed due inherited server/mail settings and was interrupted; one existing mail test attempted a provider request that failed to resolve. No successful delivery was reported. Sanitized reruns passed. This changes only test child environments, never stored credentials.

### Foundation F01 committed evidence

Commit `0b872a877f86a625dfae854a91a54cbe626ad4c5` ([diff](https://github.com/gennit-project/multiforum-backend/commit/0b872a877f86a625dfae854a91a54cbe626ad4c5)). Exact source tree passed TypeScript, 5 units and 4 live production-schema parity tests. Cumulative hooks passed lint, TypeScript and 1,917 units.

### Slice 05 — notification snapshots

Eight domain CRUD sites moved to fixed named generated-schema documents, preserving original $where input types, selection fields, default limits, anonymous sensitive-content filters, scalar errors and union resolution. Five acquisitions removed; 454 CRUD sites in 132 files and 92 acquisitions remain, plus 2 CLI sites. This is a CRUD-site/file metric, not a claim that every affected file has no OGM dependency.

User-model acquisition guards/write dependencies remain in notification hooks for slice06 and runtime wiring cleanup; the existing case-insensitive raw-driver mention fallback is unchanged. No notification writes or event deduplication semantics changed. Independent review verified exact moved selections, recipients, ordering and failure contracts; Issue fixture relationship corrected and nonempty recipient/union cases added. Final downstream archive fixtures now inject the named snapshot dependency through existing callers; no notification assertions weakened. Full combined-tree checks gate the commit.

### Reproducing slice verification

Use a clean child environment as above and the repository-pinned toolchain. Shared gates: `pnpm run lint`, `pnpm run tsc`, `pnpm test`, `pnpm run build`, `pnpm run lint:circular`. Targeted live command: `TS_NODE_TRANSPILE_ONLY=true TESTCONTAINERS_REUSE_ENABLE=false node --loader ts-node/esm --test --test-concurrency=1` followed by the relevant files under tests/integration: instancePolicyRepository.test.ts (01), contributionTargetRepository.test.ts and contributionsQueries.test.ts (02), subscriptionTargetRepository.test.ts (04), generatedSchemaOperations.test.ts (F01), notificationSnapshotRepository.test.ts plus existing commentNotifications.test.ts/issueActivityFeed.test.ts coverage (05; see actual filenames and exact evidence below). All graph data is disposable; external services are mocked.

### Slice 05 committed evidence

Commit `a07af6a9704e247d04d4d5711fa5a55697ca5b72` ([diff](https://github.com/gennit-project/multiforum-backend/commit/a07af6a9704e247d04d4d5711fa5a55697ca5b72)). Independent `review_subscription` approved final wiring and fixture corrections. Exact committed source tree `79ee68d578090853214a43d89e1bbd026e132e7e` passed lint, TypeScript, all 1,920 unit tests, build and circular checks. Expanded live checks passed 41/41 across notificationSnapshotRepository, commentNotifications, issueActivityFeed, notificationHooks, versionHistoryHooks and archiveImage integration files; all against disposable Neo4j.

Post-05 inventory recheck at `a07af6a`: TypeScript receiver analysis found 451 generated-model CRUD calls; three unchanged structurally typed injected operations (buildBotInvocationContext Comment.find, setProfileImage User.update, setChannelIcon Channel.update) bring the domain total to 454 in 132 files. Optional-chain-aware model acquisition scan found 92 acquisitions in 27 files. The structural adapters remain explicitly counted; CLI and generic forwarding are separate.

Exact-head CI for `a07af6a`: [container run 39437972349](https://github.com/gennit-project/multiforum-backend/actions/runs/39437972349) build-publish-smoke passed; publishing jobs skipped on the PR. [Tests CI 39437972218](https://github.com/gennit-project/multiforum-backend/actions/runs/39437972218) performance budgets passed; unit coverage and integration shards were still running when recorded. Earlier-head cancelled shards are not counted as passes.

### Slice 07 — role filter guards

Four CRUD sites and four acquisitions replaced by fixed generated-schema operations in channelRoleEscalation, nestedRoleEscalation and channelRoleOwnershipMiddleware. Arbitrary filters, existing projections, sequential ownership/capability decisions and fail-closed behavior preserved. Independent `review_contributions` approved after adding production-equivalent schema registration to the permission harness and capability field drift tests. Focused units 39/39 and live parity/authenticated-role tests 13/13 passed in the isolated worktree. Parent exact-tree gates pending. Remaining inventory: 450 domain CRUD sites in 129 files, 88 acquisitions, 2 separate CLI sites.
