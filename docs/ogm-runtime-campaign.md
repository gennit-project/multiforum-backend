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
| 03 Account/email | 7 | 01; write/event parity | Ownership, normalization, duplicate account/email and nested creation | complete |
| 04 Subscription target reads | 10 | None; preserve existing raw writes | Missing targets, repeats, selected response parity; no new events | complete |
| 05 Notification snapshots | 8 | 01 where age filtering applies | Recipients/preferences/actor exclusions; email-before-in-app ordering | complete |
| 06 Notification creation | 1 | 05; shared publisher contract | Nested notification graph/events and caught-error boolean contract | complete |
| 07 Role filter guards | 4 | Named-schema operation contract | Arbitrary/nested filters; missing/multiple-owner fail-closed authorization | complete |
| 08 Wiki filter guards | 2 | Named-schema operation contract | Locked pages, arbitrary filters and unique channel ownership | complete |
| 09 Content validation | 4 | Named-schema operation contract; 01 | Existing-file/filename fallback, filters, preferences and exact errors | complete |
| 10 Collections | 4 | Named-schema operation contract; retain creation adapter until 31 | Filter merge precedence, visibility, sensitivity and default sorting | complete |
| 11 Forum membership | 16 | 06; write/event contract | Split moderator vs owner/admin; sequential-write partial failures and event counts | complete |
| 12 Server membership | 13 | 06; write/event contract | Split admin vs moderator; repeat acceptance, partial failures and events | complete |
| 13 Reactions/sticky | 6 | Write/event contract | Actor checks, repeated reactions/removals and sticky order | reviewed subdivisions; integration pending |
| 14 Votes | 14 | Write/event contract; retain raw vote ordering | Split comment/discussion/supervote; weights, author unions, karma and race behavior | pending |
| 15 Scratchpad | 7 | Write/event contract | Ownership, visibility, missing entries and relationship cleanup | reviewed; integration pending |
| 16 Image creation/profile | 4 | Storage mocks; write/event contract | Variant/upload/database ordering and failures, all external IO mocked | pending |
| 17 Wiki actions | 8 | 08; write/event contract | Permissions, channel scope, ordering and relationship events | pending |
| 18 Issue target/identity | 9 | Issue identity and allocation characterization | Every target kind; mirrors, immutable identity and allocation boundaries | reviewed subdivisions; integration pending |
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
| 35 Plugin read models | 20 | 01; visibility/redaction contract | Split configuration vs run/visibility reads; redaction, order and empty states | complete |
| 36 Plugin registry/install | 22 | 37 secrets before install; external IO mocks | Two commits refresh 13/install 9; verification/download/write/rename failure ordering | pending |
| 37 Plugin config/secrets | 16 | 35; configuration/secret masking contract | Three commits secrets 5/server 6/channel 5; masking, rename, inheritance and auth | reviewed subdivisions; integration pending |
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

### Slice 07 committed evidence

Commit `dd14fee16c439a5fa29ba79942c5993d12aedc9c` ([diff](https://github.com/gennit-project/multiforum-backend/commit/dd14fee16c439a5fa29ba79942c5993d12aedc9c)), source tree `6dfd87eb6a1272570757b85e7d35880c3d90ab9f`: lint, TypeScript, all 1,935 units and 13 live parity/authenticated-role tests passed. Inventory recheck:447 generated-model calls +3 structural injected calls =450 runtime CRUD sites;88 acquisitions in24files.

### Slice 06 — notification creation

Replaced notificationHelpers User.update with one fixed named nested mutation. Preserves exact ordered default User projection and supported generated-schema event publication, repeated distinct notifications, missing-user false result, input coercion and committed writes/events on response projection errors. Six write-only model acquisitions removed; initial user-mention lookup guard remains for legacy fallback. Independent review_subscription approved final25-file patch and independently passed61units/6live; existing14version-history integrations also passed. Availability guards remain before notification/email work. Parent exact-tree gates pending. Remaining449 CRUD sites/128files,82acquisitions,2CLI sites.

CI update for `a07af6a`: Tests CI39437972218 completed with one failing moderator-suspension integration assertion (expired list0 vs1); seven other integration shards, unit coverage, coverage report and performance budgets passed. Separate investigation reproduced a pre-existing late-cleanup/fixture-ID race on baseline006f625 and a07af6a. Test-only synchronization fix is under independent review; this failed run is not counted as passing.

Slice06 first cumulative hook attempt: lint/TypeScript passed;1,935 of1,937 units passed, with2 old edit-notification mocks failing. Commit blocked pending fixture migration and full rerun. Expanded live35/35 passed on source tree4f474e956c6c5f8e2532719940f194d93d75879b.

### Slice 06 committed evidence

Commit `959d826103c0a4380d679507d519ded6ec3689bc` ([diff](https://github.com/gennit-project/multiforum-backend/commit/959d826103c0a4380d679507d519ded6ec3689bc)), tree `fd49cca69229f8d244d150d0c548c61c8d4743c4`: lint, TypeScript, all1,937units and6live parity tests passed. Expanded35live tests passed before the test-only edit fixture correction; production sources are identical. Independent reviewer approved both the final fixture correction and integrated context wiring.

### Slice 08 — wiki filter guards

Two CRUD sites and two acquisitions replaced by fixed named queries preserving distinct projections, arbitrary filters,25-item defaults, generated errors, duplicate edit reads and ownership/lock checks. Independent review_slice1 approved;33focused units and9live parity tests passed. Parent exact-tree gates pending. Remaining447CRUD sites/126files,80acquisitions,2CLI sites.

### Slice 08 committed evidence

Commit `31ea9dd0da41d49004525ba9042209bfbcf58874` ([diff](https://github.com/gennit-project/multiforum-backend/commit/31ea9dd0da41d49004525ba9042209bfbcf58874)), tree `5bdb0fa656908460ccf41d0f2864fbe201cdd2e7`: lint, TypeScript, all 1,942 unit tests and 9 live parity tests passed. Independent reviewer also approved the final context merge.

### Milestone and continuation

Seven domain slices (01, 02, 04, 05, 06, 07, 08) and foundation F01 are complete. The runtime-removal checkpoint is **not complete**. Reaudit finds 444 generated-model CRUD calls plus three unchanged structural adapters = **447 calls in 126 files**, with **80 model acquisitions in 19 files**. Two CLI CRUD sites remain separate. Acquisition and type counts overlap the CRUD inventory; do not add them together.

Next unblocked slices: 09 content validation (4 calls), 10 collections (4 calls; retain creation adapter until 31), and 35 plugin read models (20 calls, split configuration reads from run/visibility reads). Account/email slice 03 (7 calls) can follow the established write/event characterization. Continue the approved remaining ledger without requesting renewed authorization. First inspect the latest exact-head CI and resolve in-scope failures. Runtime wiring, CLI, type/package phases and all prohibitions remain as documented above.

### CI suspension test isolation

Published `a07af6a` passed unit coverage, seven integration shards, performance, coverage-report and container smoke gates; shard 1 failed one expired-suspension assertion. Controlled disposable-Neo4j probes reproduced a late-cleanup race on both baseline `006f625` and `a07af6a`: the preceding test's deliberately unawaited production cleanup can remove a newly reset fixture with identical IDs. This explains a sufficient mechanism matching the CI symptom, although its exact historical interleaving cannot be proven.

The independently reviewed fix changes only modSuspensionEnforcement.test.ts: capture and await that test's real cleanup before the next fixture reset, retain the original assertions, and assert the relationship was removed. Six live tests, TypeScript and targeted lint passed before integration. Production cleanup behavior is unchanged. Final cumulative commit gates and exact remote SHA/CI status are recorded in PR #354; a failed or pending CI run is never counted as passing.

All focused/full unit counts above overlap; they are individual verification runs, not additive coverage totals. Failed attempts are retained as history and superseded only by explicitly recorded successful reruns. The environment disconnect was resolved: command execution, disposable live tests, commits and remote SHA verification succeeded afterward.

### Mail test boundary correction

Investigation identified services/mail/index.test.ts, “sendEmail returns false when provider is not configured”, at 2026-10-20T13:46:51.427Z. Its fixture restored inherited provider configuration and called the native Resend SDK. The SDK's generic error also covers response parsing, so earlier wording about a request failing to resolve must not be read as proof that no data was transmitted or delivery accepted. No successful response ID or receipt appears in the preserved log; actual transmission/delivery remain unverified. No provider-side access was used to investigate. See mail-test-isolation.md for sanitized evidence.

The independently reviewed test-only correction clears inherited mail settings, denies native Resend and SendGrid sends, and asserts zero native attempts despite caught errors. Configured-provider tests still use injected fake clients. Synthetic ambient-configuration checks pass; deliberate missing-injection tests fail before transport. Infrastructure-only process launching remains mandatory for the broader suite. Original logs are preserved locally and must not be published wholesale.

### Mail boundary committed evidence

Commit `c5120be569429cfcb1964c74c36fbb07dc42d478`, tree `36d4266cc6a1c273a035e8928859cbb861da97ea`: lint, TypeScript and all 1,943 units passed. The synthetic inherited-configuration mail check passed 12/12; independent negative tests detected both deliberately unmocked providers before transport. No provider-side requests were made during investigation. Historical transmission/delivery remain uncertain as documented in mail-test-isolation.md.

### Slice 09 — content validation

Four CRUD sites in three files and two model acquisitions replaced with fixed named operations. Generated input validation, exact projections, filename fallback, preferences and anonymous nested sensitive-content filtering remain unchanged; emoji writes remain in their existing slice. Independent review_slice1 approved after stronger nested-filter tests. Focused43 and live7 tests passed; parent exact-tree gates pending. Remaining443 calls/123files and78 acquisitions/17files, plus2CLI sites.

### Slice35b decision history — subsequently approved

At the original decision checkpoint, customResolvers/queries/getPluginConfigStatus.ts was paused: getResolver's Plugin.find, ServerConfig.find and ServerSecret.find (three baseline sites). Version and stored pluginVersion.id currently enter interpolated GraphQL selection text. Synthetic characterization shows ordinary strings retain matching, quotes can produce syntax errors, backslash escapes are decoded, and crafted values can alter selections. Literal variables intentionally change those special-input behaviors and prevent query alteration. No workaround preserving injection and no silent behavior correction is authorized. Parent has requested explicit approval; safe35a and35c continue independently.

If approved, test ordinary version/ID matching, quotes, literal backslashes, attempted extra selections, stored IDs with special characters, missing/not-installed outcomes, authorization/redaction, existing error prefixes, default selections/limits and unchanged graph state. Keep this named operation scoped to the existing generated schema and do not expand access. All35 subdivisions total20 baseline sites (4+3+5+4+4), not additional inventory.

### Continuation verification

Exact published head `658bfe4fcf8469c6f2801c99e90d59d641d5d58a`: Tests CI [39441524212](https://github.com/gennit-project/multiforum-backend/actions/runs/39441524212) and container run [39441524405](https://github.com/gennit-project/multiforum-backend/actions/runs/39441524405) completed successfully. These results apply to that SHA only.

The first slice09 cumulative hook failed two unchanged channel-preference fixtures still injecting OGM and one Node26 V8 native fatal error in localDevAuth.test.ts. The fixture correction preserves all assertions and injects the new boundary; independent review requested. Standalone localDevAuth rerun passed23/23 without source changes. Exact staged production tree passed7/7 live validation tests. Full cumulative rerun remains required before commit.

Slice09 committed `376ad24740f966849d5dd59b3c66760e16eb045d`, tree `9615b2df9a0aa4c947281c953d77147364cebb1f`: full lint, TypeScript and unit suite passed;7live passed on identical production sources before independently reviewed fixture correction. Failed initial run retained above.

### Slice 03a — Account registration and own email summary

5 baseline CRUD sites removed. Independent review_contributions approved; no unresolved findings. 12 focused units,7 live parity and3 existing age integrations passed; exact User/Email defaults, normalization, validation, creation ordering and post-write projection failures retained. Parent cumulative gates pending. Remaining 438 CRUD sites/121 files; 77 acquisitions/17 files; two separate CLI sites.

Slice03a committed `70bffdffc205a75c86209282d22949a290a87392` ([diff](https://github.com/gennit-project/multiforum-backend/commit/70bffdffc205a75c86209282d22949a290a87392)), tree `30950f4967aec5d46565966f9cadede3a87016ef`: lint, TypeScript and all1957 units passed; 7 exact-tree live parity tests passed. Independent approval recorded above.

### Slice 03b — Email recipient and notification persistence

2 baseline CRUD sites removed. Independent review_contributions approved; native provider denial and fake delivery verified. 14 focused units,5 live parity and16 existing invitation integrations passed; omitted notificationType, duplicate events, email-before-in-app ordering and server-invite best effort preserved. Parent cumulative gates pending. Remaining 436 CRUD sites/120 files; 77 acquisitions/17 files; two separate CLI sites.

Slice03b committed `c090cb21bd20415b2c88bf61e69921d96bcdfcb0` ([diff](https://github.com/gennit-project/multiforum-backend/commit/c090cb21bd20415b2c88bf61e69921d96bcdfcb0)), tree `d6dc41dd7811d72b87c678958f7e5c314448f583`: lint, TypeScript and all1963 units passed; 5 exact-tree live tests passed; external mail fake and native SDKs denied. Independent approval recorded above.

### Slice 10 — Collection reads

4 baseline CRUD sites removed. Independent review_subscription approved; no remaining findings. 15 focused units,6 live parity and4 public collection integrations passed; filter merge precedence, visibility/age filters, defaults and errors preserved; creation adapter retained for31. Parent cumulative gates pending. Remaining 432 CRUD sites/117 files; 74 acquisitions/15 files; two separate CLI sites.

### Additional isolated decision — enableServerPlugin (37b2)

The four-site enableServerPlugin operation also interpolates version and stored plugin-version ID into selection text. Its migration remains paused separately from the three getPluginConfigStatus lookups. Approval scoped to35b does not automatically cover this path. Do not preserve query alteration as a workaround. Required characterization includes ordinary and special-string version/ID matching, quote/backslash handling, attempted selection alteration, existing validation/error order, configuration/installation state, native events and unchanged graph state on rejected requests. Secret operations37a, updatePluginPipelines37b1 and channel configuration37c do not depend on this behavior and may proceed independently.

Slice10 committed `0ed821a91bc646006e3a3142abf5d7651c29b1a7` ([diff](https://github.com/gennit-project/multiforum-backend/commit/0ed821a91bc646006e3a3142abf5d7651c29b1a7)), tree `9e8b9fd4487cb60238c0231d41d5e1207b2e67ab`: lint, TypeScript and all1970 units passed; 6 exact-tree live parity tests passed. Independent approval recorded above.

### Slice 35a — Plugin configuration reads

4 baseline CRUD sites removed. Independent review_subscription approved before pause; final patch preserved. 17 focused units,4 live parity and4 authorization tests passed; exact selections, redaction, registry failures and reconciliation ordering preserved. Parent cumulative gates pending. Remaining 428 CRUD sites/114 files; 74 acquisitions/15 files; two separate CLI sites.

### Recovery and scoped behavior approval

Recovered clean branch at0ed821a with unpublished03b and10 commits and preserved reviewed patches. Remote remained70bffdf; main006f625. User approved literal ID/version variables for exactly three getPluginConfigStatus lookups (35b), intentionally treating quotes/backslashes as data and preventing selection alteration. Edge-case tests are required. The separate enableServerPlugin operation37b2 remains paused; this approval does not cover it. Historical mail transmission/delivery remains uncertain; the published native-provider test guard is retained.

Slice35a initial cumulative run passed lint/TypeScript and1,975 test entries but failed loading services/pluginRunner.test.ts with a Node26/V8 native “unreachable code” fatal error. Its isolated sanitized rerun passed without source changes; full gate rerun required. Four exact-production-tree live configuration tests passed. The failed attempt is retained and is not counted as successful.

Slice35a committed `012ee3e58a3d488205920f3cdad5209bd385f312` ([diff](https://github.com/gennit-project/multiforum-backend/commit/012ee3e58a3d488205920f3cdad5209bd385f312)), tree `dcf6b9ee09adf973007d0c1bfd7b466c3925954c`: lint, TypeScript and all1976 units passed; 4 live parity tests passed on identical production sources before documentation-only failure evidence update; isolated pluginRunner recheck passed. Independent approval recorded above.


### Slice 35b — Approved literal-variable plugin status lookups

3 baseline CRUD sites removed. Independent review_recovery approved; nine unit/auth checks independently rerun. 9 unit/auth and6 live tests passed; user-approved quote/backslash-as-data correction, selection-alteration attempts treated literally, normal behavior/redaction/defaults preserved;37b2 unchanged. Parent cumulative gates pending. Remaining 425 CRUD sites/113 files; 74 acquisitions/15 files; two separate CLI sites.

Slice35b committed `3cb0a8ecb11a0727e1c24633c25863850d983dac` ([diff](https://github.com/gennit-project/multiforum-backend/commit/3cb0a8ecb11a0727e1c24633c25863850d983dac)), tree `257f3e7691bb2071b99312a796343f27a34777c8`: lint, TypeScript and all1985 units passed; 6 integrated live parity/correction tests and focused auth check passed; reviewed auth fixture included. Independent approval recorded above.

### Slice 35c1 — Pipeline applicability and visibility

5 baseline CRUD sites removed. Independent review_slice1 approved; preserved final patch and strengthened live evidence. 23 focused units and5 live parity tests passed; exact visibility, anonymous sensitive filters, nested limits and missing-target behavior preserved. Parent cumulative gates pending. Remaining 420 CRUD sites/111 files; 74 acquisitions/15 files; two separate CLI sites.

Slice35c1 committed `443b7e6d239a720800bf59daea10419621a0c1f4` ([diff](https://github.com/gennit-project/multiforum-backend/commit/443b7e6d239a720800bf59daea10419621a0c1f4)), tree `a2816f729b3ddca90f312d3e6cf9b122eda92f1f`: lint, TypeScript and all1990 units passed; 5 exact-tree live applicability/visibility parity tests passed. Independent approval recorded above.

### Slice 35c2 — Pipeline history and summary reads

4 baseline CRUD sites removed. Independent review_slice1 approved; no unresolved findings. 12 focused units,3 live parity and4 authorization tests passed; history defaults remain unbounded, sort/read order and public redaction preserved. Parent cumulative gates pending. Remaining 416 CRUD sites/108 files; 74 acquisitions/15 files; two separate CLI sites.

Slice35c2 committed `55c0701cb88f2ace84991fabc1a4fc118cdc26e4` ([diff](https://github.com/gennit-project/multiforum-backend/commit/55c0701cb88f2ace84991fabc1a4fc118cdc26e4)), tree `e35f870228aed3befc4f10172912cbeaf7a133e1`: lint, TypeScript and all1994 units passed; 3 exact-tree live history and summary parity tests passed. Independent approval recorded above.

### Slice 35c3 — Public and internal pipeline detail reads

4 baseline CRUD sites removed. Independent review_slice1 approved; no unresolved findings. 13 focused units,3 live parity and4 authorization tests passed; public visibility/redaction and internal diagnostics preserved with exact ordering and defaults. Parent cumulative gates pending. Remaining 412 CRUD sites/106 files; 74 acquisitions/15 files; two separate CLI sites.

### Preserved reviewed integration queue

The JSON ledger now records prepared patch hashes, baselines and independent evidence for11a/b/c,12a/b/c,13a/b,15,37a/b1/c and18a. These are reviewed worktree patches, not completed or published slices; integration, cumulative gates and separate commits remain required. Patch paths refer to the preserved cloud workspace. Counts in remainingRuntimeCrudSites include only changes already integrated into this branch, never queued removals.37b2 remains separately paused.

Slice35c3 committed `c19c5378184e2717d24aaa8ecdb0fb85d8dad7a3` ([diff](https://github.com/gennit-project/multiforum-backend/commit/c19c5378184e2717d24aaa8ecdb0fb85d8dad7a3)), tree `b4db7de98b5c07bc03cfaff9f5b8f9a986feb110`: lint, TypeScript and all1999 units passed; 3 exact-tree disposable Neo4j parity tests; cumulative build and circular dependency checks passed. Independent approval recorded above.

### Slice 11a — Forum owner membership

7 baseline CRUD sites removed. Independent review_subscription approved frozen patch; integration_review approved exact factory/context merge and independently passed8 focused checks. 8 focused units and 12 production-schema live parity tests passed on reviewed patch; cumulative gates pending. Parent cumulative gates pending. Remaining 405 CRUD sites/102 files; 74 acquisitions/15 files; two separate CLI sites.

Slice11a committed `3567c3820fa05f2bfd9e80765be99ed683f0b411` ([diff](https://github.com/gennit-project/multiforum-backend/commit/3567c3820fa05f2bfd9e80765be99ed683f0b411)), tree `98ab07aafed3e5c92cd99ad94f6cd01a847e441c`: lint, TypeScript and all2007 units passed; 12 disposable live parity tests passed on identical production sources before documentation-only review update. Independent approval recorded above.

### Slice 11b — Forum moderator membership

7 baseline CRUD sites removed. Independent review_subscription approved original patch; integration_review approved exact factory/context merge and independently passed7 focused checks. 13 focused units and12 live parity tests passed on reviewed patch; cumulative gates pending. Parent cumulative gates pending. Remaining 398 CRUD sites/99 files; 74 acquisitions/15 files; two separate CLI sites.

Reviewed19a/19b/19c artifacts and hashes are recorded in JSON; their removals are not credited until integration. Production initialization omits hidden fields from Issue default projections;19a parity follows that actual initializer.19c retains nested comment writes and original non-atomic failure boundaries.

Slice11b committed `100901653b2ab169c0b89f057c8c4392f93418b2` ([diff](https://github.com/gennit-project/multiforum-backend/commit/100901653b2ab169c0b89f057c8c4392f93418b2)), tree `44e10b5249b98d336a4ce290a103a7f950fe7aca`: lint, TypeScript and all2014 units passed; 12 live parity tests passed on identical production sources before documentation-only review update. Independent approval recorded above.

### Slice 11c — Forum invitation writes

2 baseline CRUD sites removed. Independent review_contributions approved original patch; integration_review approved final factory merge and independently passed8 focused email checks with native transports denied. 8 focused units and11 live parity tests passed on reviewed patch; native mail transports denied and injected fake senders; cumulative gates pending. Parent cumulative gates pending. Remaining 396 CRUD sites/97 files; 74 acquisitions/15 files; two separate CLI sites.

14a/b/c votes independently approved in isolatedworktrees; prepared artifacts recorded without crediting queued removals. Initial live fixture assumptions corrected (required-field response failure, Neo4j integer conversion, generated event-envelope IDs, actual relationship name, existing fragment-only User projection failure); strengthened final live checks passed, no production workaround. Final exact-tree static exits confirmed, not inferred from pending processes.

20/21a/21b independently reviewed artifacts recorded without crediting queued removals.20 reversed test relationship corrected with explicit notification title/recipient assertions; final6live passed.21 baseline has no recent-version deduplication; migration preserves repeated snapshots and distinct standard/custom middleware semantics.

Slice11c committed `1f539e8a515e64c5c9854522b39fafe6599579e3` ([diff](https://github.com/gennit-project/multiforum-backend/commit/1f539e8a515e64c5c9854522b39fafe6599579e3)), tree `a5601f5047754b2d229161080cf6e21ba1fa7af0`: lint, TypeScript and all2016 units passed; 11 disposable live parity tests passed on identical production sources before documentation-only review update; cumulative exact-tree build and circular checks passed. Independent approval recorded above.

### Slice 12a — Server admin membership

4 baseline CRUD sites removed. Original patch independently approved review_subscription; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 392 CRUD sites/95 files; 74 acquisitions/15 files; two separate CLI sites.

16 independently approved artifact recorded without crediting queued removals;4CRUD comprises2typed+2structural calls, requiring audit adjustment3→1 only when integrated. Existing variantUrls map-property rejection preserved; native storage/HTTP attempt guards stayed zero.

12a final integration approval: integration_review independently verified seven nonmerge blobs exactly match reviewed patch, factory/context changes limited to two server-admin constructors and repository field/import; prior campaign wiring retained. Independent 6 focused tests passed actual exit 0 (/tmp/review12a-integration-focused.log); diff-check passed. No findings.; live parity passed on identical production sources before this documentation-only update.

Slice12a committed `fa87561dea7bb4ea160d21f11f8fcd419eb1c624` ([diff](https://github.com/gennit-project/multiforum-backend/commit/fa87561dea7bb4ea160d21f11f8fcd419eb1c624)), tree `bfb95eae46963bdce80e443a5231c7524d6d41ef`: lint, TypeScript and all2022 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice12a-exact-live.log. Independent approval recorded above.

### Slice 12b — Server moderator membership

5 baseline CRUD sites removed. Original patch independently approved review_subscription; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 387 CRUD sites/93 files; 74 acquisitions/15 files; two separate CLI sites.

12b final integration approval: integration_recovery independently verified six nonmerge patch blobs, minimal factory/context merge and retained prior wiring;6 focused tests passed actual exit0; staged diff-check clean. Evidence /tmp/recovery-review12b-focused.log; live parity passed on identical production sources before this documentation-only update.

Slice12b committed `3c82861621d6982ec33c7304877d329759ad37db` ([diff](https://github.com/gennit-project/multiforum-backend/commit/3c82861621d6982ec33c7304877d329759ad37db)), tree `73929ccb3d5b1d5531a5411e47365ec7225484ad`: lint, TypeScript and all2028 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice12b-exact-live.log. Independent approval recorded above.

### Slice 12c — Server invitation writes

4 baseline CRUD sites removed. Original patch independently approved review_subscription; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 383 CRUD sites/91 files; 74 acquisitions/15 files; two separate CLI sites.

12c final integration approval: integration_recovery independently verified five nonfactory blobs, minimal factory merge retaining drivers and prior membership wiring;10 focused email tests passed actual exit0 with native Resend/SendGrid guards and zero-attempt assertions; staged diff-check clean. Evidence /tmp/recovery-review12c-focused.log; live parity passed on identical production sources before this documentation-only update.

Slice12c committed `660336222db451f98b083643c22704f9516e1c5d` ([diff](https://github.com/gennit-project/multiforum-backend/commit/660336222db451f98b083643c22704f9516e1c5d)), tree `33b38d3cf242569a0cca4582dd557515be5ff67f`: lint, TypeScript and all2030 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice12c-exact-live.log. Independent approval recorded above.

### Slice 13a — Reactions

4 baseline CRUD sites removed. Original patch independently approved review_subscription; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 379 CRUD sites/87 files; 74 acquisitions/15 files; two separate CLI sites.

17/22/23a/23b reviewed artifacts recovered and recorded without counting queued removals.17 default25 fixture and nullable serverName test contract corrected;22 test lib compatibility corrected;23b malformed temporal value retains original body/no events. No corresponding production behavior fixes. Exact c19c537 Tests CI39513884838 and container39513884891 both passed, including eight integration shards, combined coverage and performance budgets. Later-head CI remains separate.

Reviewed24a/38a artifacts recorded without crediting queued removals.38a removes one structural call, so its integration must reduce manual audit adjustment separately from16.24a fixture-only relationship/synchronous-error helper/rowtyping corrections retain original production contracts.

13a final integration approval: integration_recovery independently verified eight nonfactory patch blobs, exact four reaction-writer constructor changes and retained prior wiring; focused reaction/preference tests passed actual exit0; staged diff-check clean. Evidence /tmp/recovery-review13a-focused.log; live parity passed on identical production sources before this documentation-only update.
