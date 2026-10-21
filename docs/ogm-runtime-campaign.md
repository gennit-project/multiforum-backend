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
| 13 Reactions/sticky | 6 | Write/event contract | Actor checks, repeated reactions/removals and sticky order | complete |
| 14 Votes | 14 | Write/event contract; retain raw vote ordering | Split comment/discussion/supervote; weights, author unions, karma and race behavior | complete |
| 15 Scratchpad | 7 | Write/event contract | Ownership, visibility, missing entries and relationship cleanup | complete |
| 16 Image creation/profile | 4 | Storage mocks; write/event contract | Variant/upload/database ordering and failures, all external IO mocked | complete |
| 17 Wiki actions | 8 | 08; write/event contract | Permissions, channel scope, ordering and relationship events | complete |
| 18 Issue target/identity | 9 | Issue identity and allocation characterization | Every target kind; mirrors, immutable identity and allocation boundaries | complete |
| 19 Issue activity/lock | 11 | 18; 05–06 | Actor/activity references, lock transitions and notification order | complete |
| 20 Comment revisions | 6 | 18–19 | Snapshots, deduplication, authors, revision refs and ageGateTouchedAt | complete |
| 21 Discussion revisions | 12 | 18–19 | Title/body/no-op updates, recent-version dedupe and revision refs | complete |
| 22 Event revisions | 9 | 18–19 | Event-specific snapshots/defaults; no unsupported repository reuse | complete |
| 23 Wiki revisions/redaction | 9 | 18–19; 08 | Separate revision/redaction commits; visibility, authors and redaction authorization | complete |
| 24 Content reports | 17 | 18–19; 05–06 | Separate entity commits; existing reports, numbering, activity and notifications | complete |
| 25 Image/profile/wiki reports | 17 | 18–19; 05–06; 23 for wiki | Separate image-family/wiki commits; owner vs target and replaced images | complete |
| 26 Channel moderation | 9 | 18–19; 05–06 | Repeated actions, moderation state, activity and recipients | complete |
| 27 Comment moderation | 11 | 18–20; 05–06 | Archive metadata, history, issue effects and notifications | complete |
| 28 Discussion/event moderation | 18 | 18–19,21–22; 05–06 | Split discussion 9/event 9; entity-specific history and notifications | complete |
| 29 Image moderation/removal | 17 | 18–19; 05–06; storage mocks | Split archive pair 11/permanent removal 6; storage failure windows | complete |
| 30 Suspensions | 7 | 18–19; 05–06 | All user/mod wrappers, scope, duration, authorization and activity | complete |
| 31 Discussion create/update | 6 | 21; 05–06; closes 10 adapter | Connections, explicit transaction propagation, rollback and history | complete |
| 32 Event create/update | 5 | 22; 05–06; external transaction/event gate | Explicit transaction/event timing, rollback and connections | complete |
| 33 Event recurrence | 19 | 32; external transaction/event gate | Three commits: create 2/update 9/delete 8; recurrence scope and independent deletes | complete |
| 34 Download review/labels | 14 | Retain pipeline adapter until 41/44 controls | Split review/preparation 7/labels 7; scan state and label history | complete |
| 35 Plugin read models | 20 | 01; visibility/redaction contract | Split configuration vs run/visibility reads; redaction, order and empty states | complete |
| 36 Plugin registry/install | 22 | 37 secrets before install; external IO mocks | Two commits refresh 13/install 9; verification/download/write/rename failure ordering | complete |
| 37 Plugin config/secrets | 16 | 35; configuration/secret masking contract | Three commits secrets 5/server 6/channel 5; masking, rename, inheritance and auth | complete |
| 38 Bot identity/comments | 13 | 03; write/event contract | Nested identity creation, activation/deprecation, channel links and comment context | complete |
| 39 Bot reports | 6 | 18–19; 38 | Issue identity, report deduplication and actor attribution | complete |
| 40 Pipeline leases/attempts | 14 | Lease/attempt state characterization; 44 notifications before dependent consumers | Separate lease 6/attempt 4/watchdog 4; competing claims, stale leases, heartbeat, timeouts | complete |
| 41 Pipeline download execution | 12 | 40; 44 notifications; 34 as applicable | Runner side effects outside retried callbacks; statuses/retries/results | pending |
| 42 Pipeline channel execution | 13 | 40; 44 notifications; 38 | Channel applicability, bots, statuses and execution failure ordering | pending |
| 43 Pipeline comment execution | 11 | 40; 44 notifications; 38 | Comment applicability, recursion guards, middleware wiring and ordering | pending |
| 44 Pipeline control/notifications | 18 | Notifications before 40–43; controls after 41–43 and 34 | Notifications 4 first, controls 14 later; conditional claim failure windows and retry eligibility | partial; see subdivisions |
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

Slice13a committed `21b56de485a75f8451d6bd724ecbcb0156559bdb` ([diff](https://github.com/gennit-project/multiforum-backend/commit/21b56de485a75f8451d6bd724ecbcb0156559bdb)), tree `c3ab05b624442420df8d50e0a89c63e11c1d939c`: lint, TypeScript and all2044 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice13a-exact-live.log. Independent approval recorded above.

### Slice 13b — Sticky comments

2 baseline CRUD sites removed. Original patch independently approved review_subscription; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 377 CRUD sites/86 files; 74 acquisitions/15 files; two separate CLI sites.

13b final integration approval: integration_recovery independently verified four nonfactory patch blobs, exact two sticky repository constructor changes and retained prior wiring;8 focused tests passed actual exit0; staged diff-check clean. Evidence /tmp/recovery-review13b-focused.log; live parity passed on identical production sources before this documentation-only update.

Slice13b committed `a185e6ea7aeaa1098864fe65ed77800e04629f92` ([diff](https://github.com/gennit-project/multiforum-backend/commit/a185e6ea7aeaa1098864fe65ed77800e04629f92)), tree `07ac50e1b38e73a3563a16e97b211b970072318c`: lint, TypeScript and all2047 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice13b-exact-live.log. Independent approval recorded above.

### Slice 15 — Scratchpad

7 baseline CRUD sites removed. Original patch independently approved review_subscription; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 370 CRUD sites/83 files; 74 acquisitions/15 files; two separate CLI sites.

15 final integration approval: Independent integration_review_current approved exact tree 72a5386ade1c8538a0bf41c4c38849710364d990: all six non-factory source/test blobs match original reviewed patch; factory merge only imports/constructs scratchpad repository and preserves driver/raw transaction and undo wiring. Independently passed 8 focused characterization tests using stripped infrastructure-only launcher; inspected completed 29/29 disposable live tests (9 parity +20 existing). No blocking findings; auth, source projections/default errors, ordering, delete relationships/events preserved.; live parity passed on identical production sources before this documentation-only update.

Slice15 committed `0f4b36bd7d4d5aac29ca6e5b4c5d5eb168c20c06` ([diff](https://github.com/gennit-project/multiforum-backend/commit/0f4b36bd7d4d5aac29ca6e5b4c5d5eb168c20c06)), tree `59b9f7dd03e5897446c4f1e9fd994fbedc5e74fb`: lint, TypeScript and all2055 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice15-exact-live.log. Independent approval recorded above.

### Slice 14a — Comment votes

6 baseline CRUD sites removed. Original patch independently approved integration_review; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 364 CRUD sites/81 files; 74 acquisitions/15 files; two separate CLI sites.

Reviewed24b/c/d and38b artifacts recorded without crediting queued removals.24c retains optional Channel acquisition as capability guard;38b integration must preserve37c/38a overlaps. No related architectural behavior corrections authorized.

Reviewed25a/b/c/d and38c/d patches queued without crediting removals.25 append operations retain immutable Issue identity guard after independent review finding and old/new rejection tests.38d preserves unbounded server reads, sequential deprecation/disconnect and swallowed synchronization errors; removes3 acquisitions when integrated. Architecture findings remain deferred to separate issues; no fixes included.

14a final integration approval: Independent integration_review_current approved exact tree 71430ccc9ce3564f4f132751288990f8f5d8f749: six nonfactory blobs match reviewed14a patch; factory only removes Comment/User inputs preserving driver. Independently44 focused tests passed with infrastructure-only launcher; inspected3 completed disposable live parity tests. Separate generated karma writes, raw transaction ordering, projections/error behavior and native events preserved. No blocking findings.; live parity passed on identical production sources before this documentation-only update.

Slice14a committed `757314c367f705e0e27ec875c34a0d7a6877b360` ([diff](https://github.com/gennit-project/multiforum-backend/commit/757314c367f705e0e27ec875c34a0d7a6877b360)), tree `2db83d21c53a1c5454ceb7e7df8bd6c3d80e5856`: lint, TypeScript and all2063 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice14a-exact-live.log. Independent approval recorded above.

### Slice 14b — Discussion votes

6 baseline CRUD sites removed. Original patch independently approved integration_review; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 358 CRUD sites/79 files; 74 acquisitions/15 files; two separate CLI sites.

14b final integration approval: Independent integration_review_current approved exact tree 822bd95af4be1bf2079eb82fa8a5efa37a9acfc0: five unmerged source/test blobs match original14b patch; factory narrowly drops DiscussionChannel/User inputs preserving driver; shared voteResolvers tests retain14a changes and add only14b adapters. Independently44 focused tests passed using infrastructure-only launcher; inspected3 completed disposable live parity tests. Existing authorization inputs, transaction ordering, separately committed karma writes, projections/errors and events preserved. No blocking findings.; live parity passed on identical production sources before this documentation-only update.

Slice14b committed `8efd2478b81c821ae1c6943e788bfbe5583683ae` ([diff](https://github.com/gennit-project/multiforum-backend/commit/8efd2478b81c821ae1c6943e788bfbe5583683ae)), tree `09d8704e6b0afa5f031308543ec9ad96ef6f48dc`: lint, TypeScript and all2071 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice14b-exact-live.log. Independent approval recorded above.

### Slice 14c — SuperUpvote undo

2 baseline CRUD sites removed. Original patch independently approved integration_review; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 356 CRUD sites/78 files; 74 acquisitions/15 files; two separate CLI sites.

14c final integration approval: Independent integration_review_current approved exact tree 8d8f33eae93f9db87c8a6a8562f8a84217fac7c0: four nonfactory blobs match reviewed14c patch; factory only removes unused model arguments and sole unused ScratchpadEntry destructure after15, preserving driver. Independently8 focused ordering tests passed with infrastructure-only launcher; inspected23 completed disposable live tests (3 parity+20 existing). Original raw transaction, scratchpad deletion, union-error behavior, nested defaults and no generated write events preserved. No blocking findings.; live parity passed on identical production sources before this documentation-only update.

Slice14c committed `172cdd9cfd062d0269cf7d1562fbb6b713d7b873` ([diff](https://github.com/gennit-project/multiforum-backend/commit/172cdd9cfd062d0269cf7d1562fbb6b713d7b873)), tree `c8bebc8b5ad591f145ddd7232d8e91da1374f0ae`: lint, TypeScript and all2079 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice14c-exact-live.log. Independent approval recorded above.

### Slice 16 — Image creation/profile

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 352 CRUD sites/75 files; 74 acquisitions/15 files; two separate CLI sites.

Slice26 channel moderation independently reviewed:9CRUD/0acquisitions prepared, no removal credit until integration. Exact fixture parity uses2admins; a separate same-graph28admin case preserves default25cap characterization. Identity guards, allocation/error/write ordering, duplicate recipients and cleanup retained.

Slice27 comment moderation independently reviewed:11CRUD/0acquisitions prepared, no removal credit until integration. Legacy test adapter corrected to production Issue identity protection; existing moderator-author projection error remains unchanged.33focused and12live passed, including6existing factory integrations.

Slice16 initial live run passed6/7 and failed1/7 due to test ID namespace collision; fixture-only namespace separation independently reviewed, production unchanged; failed log preserved.
16 final integration approval: Independent integration_review_current approved corrected tree 67d0a0801f2ce3412dcef9e4b8cda242d94dba9d: production sources match original reviewed16 patch; factory retains driver; fixture-only correction separates node/relationship/domain ID namespaces and retains all assertions after initial6/7live failure. Corrected exact-tree7/7live passed; independently35 focused passed on identical production/unit sources using stripped launcher and native storage/HTTP denial guards. Four CRUD sites (two typed+two structural) removed. No blocking findings; existing variant-object database rejection preserved.; live parity passed on identical production sources before this documentation-only update.

Slice16 committed `e6867b8f0548600887cf778321acf33e276fc4bf` ([diff](https://github.com/gennit-project/multiforum-backend/commit/e6867b8f0548600887cf778321acf33e276fc4bf)), tree `1f7708b58eac09ebbc6ec4dae659e5f9442e0b25`: lint, TypeScript and all2094 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice16-corrected-live.log. Independent approval recorded above.

### Scratchpad CI parity correction

Published172cdd9 failed only integration shard3 (run39520312148/job118962562566); seven other shards, unit/performance/coverage-report jobs and container39520312354 passed. A12-run isolated old-old/candidate-candidate probe across3relationship allocation orders showed3legacy sibling-event orders, each matched by the candidate. Installed generated delete collects adjacent relationships without ORDER BY; both paths use the same delete field/schema/context.

Test-only correction retains node-delete-first, exact4events/3typedrelationships, fullpayload/multiplicity/graph comparisons; adds rawrelationship/source/target ID checks against predeleteDB. Only unordered sibling relationships canonicalized before aliasing.11correctedlive,TypeScript,scopedlint,diffcheck passed; scratchpad_review approved testblob d340aff46b28bebf20734f4519cc78aa269946a9. Original CI evidence retained. No production behavior changed. Mandatory hook and new exact-head CI pending.

Usage-conserving workflow: one implementer and one independent reviewer; reuse reviewed artifacts; focused relevant live checks per slice and cumulative CI at meaningful milestones. Repository precommit still mandates full lint,TypeScript,unit suite per commit; it is not bypassed. Architecture issues355–360 remain deferred.37b2 variable correction is now approved per parent handoff; its implementation remains queued.

### Ownership harness CI correction

7753e92 shard1 job118975360628 failed createImageWithUploader because its older ownership harness omitted generated-schema registration. Added the same unwrapped-schema/driver registration used in production before middleware. Original ownership/auth assertions unchanged.4live ownership tests passed; scratchpad_review approved bloba4ff8d1f00f0382e61ff8b15dd2ff181081602e9. No production change.7753e92 also passed localbuild/circular and2094mandatoryunits; exactCI still has this failure until correctedheadrerun. Mandatoryhooks remain enabled.

### Slice 17 — Wiki actions

8 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 344 CRUD sites/72 files; 74 acquisitions/15 files; two separate CLI sites.

29a/b and30 recovered and independently approved;24CRUD queued, not credited removed.29b retains flags-only storage boundary.30 test correction supported by9-run legacy/candidate ActivityFeed allocation probe; rawIDs checked againstDB, nativeevents remain strictly ordered, no production correction. Final manifests preserve failures and test evidence.

31a recovered/independently approved:3CRUD queued, collection/seeder forwarding closure, plugin Discussion capability retained; no31b transaction-context change included. No removal credit before integration.

31b independently reviewed/queued:3CRUD, caller-owned generated-schema transaction execution preserved. Raw event timestamp equality checked before per-run clock normalization. No removal credit before integration.

37b2 previouslypaused correction is approved and prepared/reviewed:4CRUD queued, no removal credit before integration. Variables replace2interpolatedreads/3insertions; specialvalues intentionally literal. Ordinaryprojections, unboundedserverread, validation/settings/nativeevents/defaultprojectionerrorcontracts retained. Merge overlapping37a/b1 applyPluginConfiguration wiring narrowly.

17 final integration approval: scratchpad_review: ten nonfactory blobs match previously approved17 patch; narrow factory driver wiring verified; eight CRUD removals, no acquisition changes. Queue29/30/31/37b2 hashes/statuses match reviewed artifacts without removal credit. Final5live passed; prior20focused/static evidence reused; diff check passed. No remaining findings.; live parity passed on identical production sources before this documentation-only update.

Slice17 committed `54d2674dc01c807e773ae7b8c82752a00df9e1c4` ([diff](https://github.com/gennit-project/multiforum-backend/commit/54d2674dc01c807e773ae7b8c82752a00df9e1c4)), tree `5b492bd08ff4a55ff5629559e4064df5c3697c86`: lint, TypeScript and all2100 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice17-exact-live.log. Independent approval recorded above.

CI recovery verified: c70043c8acf4f4a75f54b409c5d93069e1d42679 [Tests39525932570](https://github.com/gennit-project/multiforum-backend/actions/runs/39525932570) and [container39525932526](https://github.com/gennit-project/multiforum-backend/actions/runs/39525932526) passed, including all eight integration shards, unit/combined coverage, performance budgets and build/static. The scratchpad and ownership harness failures are resolved; runtime implementation continues.

### Slice 18a — Issue target snapshots

8 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 336 CRUD sites/71 files; 74 acquisitions/15 files; two separate CLI sites.

28a/b independently reviewed,18CRUD/0acquisitions queued without removal credit. Event-specific authorization remains distinct; identity/default/notification/partial-failure contracts retained. Fixture-only synchronous-guard and Event POSTED_BY relationship corrections documented in manifests.

32 independently reviewed/queued:5CRUD; preserve31a seeder cleanup and dependon31b explicittransaction executor. Creationpartialfailure/nativeevents and updatepostcommit effects preserved; no removalcredit beforeintegration.

18a final integration approval: Independent cumulative review: 12 non-wiring source/test blobs exactly match previously reviewed 18a; mutation/query/context factory adaptations preserve relation target resolution, capability flags and age-policy context. Eight runtime CRUD removals, zero acquisitions; queued slices not credited. Exact snapshot live evidence /tmp/runtime-slice18a-exact-live.log: 24 passed, zero failed/skipped/cancelled. Prior focused/static evidence reused for unchanged candidate; cumulative diff check passed. Subsequent docs-only milestone.nextUnblocked correction to [18b] is permitted. Mandatory hooks remain parent gate.; live parity passed on identical production sources before this documentation-only update.

Slice18a committed `8f2004707a9c05925d8e507f7cd9dd472d0a04fb` ([diff](https://github.com/gennit-project/multiforum-backend/commit/8f2004707a9c05925d8e507f7cd9dd472d0a04fb)), tree `57c9bd70d2c87e147ee429b9fcc3b1ce1aa873cd`: lint, TypeScript and all2107 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice18a-exact-live.log. Independent approval recorded above.

### Slice 18b — Issue creation

1 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 335 CRUD sites/70 files; 74 acquisitions/15 files; two separate CLI sites.

18b final integration approval: Independent cumulative review: all four non-factory source/test blobs exactly match previously reviewed 18b tree4ea9788; sole factory adaptation removes Issue injection and retains driver. Separate number allocation and close remain outside creation catch; identity attachment stays inside catch; no atomicity redesign. One CRUD removed, zero acquisitions; ledger count335 consistent. Exact snapshot live log /tmp/runtime-slice18b-exact-live.log reports six passed, zero failed/skipped/cancelled. Reused original focused/static evidence; cumulative diff check passed. Mandatory cumulative hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice18b committed `128326601c1c9fa45d5fe732ca584d9ffc3d05e6` ([diff](https://github.com/gennit-project/multiforum-backend/commit/128326601c1c9fa45d5fe732ca584d9ffc3d05e6)), tree `afe9d8333b976eacba8002824cc6053271b43b64`: lint, TypeScript and all2113 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice18b-exact-live.log. Independent approval recorded above.

### Slice 19a — Issue activity append

2 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 333 CRUD sites/69 files; 71 acquisitions/15 files; two separate CLI sites.

19a final integration approval: Independent cumulative review: 12 non-context source/test blobs exactly match approved original tree9ed58be; context adaptation only adds optional IssueActivityRepository field/import. Fixed production default Issue selection, committed-write/projection-error behavior, sequential per-ID swallowed errors, optional notification behavior and history attribution retained. Two CRUD and three acquisitions removed; totals333/71 consistent. Exact snapshot /tmp/runtime-slice19a-exact-live.log reports25 passed, zero failed/skipped/cancelled. Prior focused/static evidence reused; cumulative diff check passed. Mandatory hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice19a committed `b7237c16e166f4b34f023f66efae29b07a891ab0` ([diff](https://github.com/gennit-project/multiforum-backend/commit/b7237c16e166f4b34f023f66efae29b07a891ab0)), tree `4815c5815ad5860233b890eca56a3c1a242d3eb0`: lint, TypeScript and all2118 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice19a-exact-live.log. Independent approval recorded above.

### Slice 19b — Issue activity middleware

5 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 328 CRUD sites/68 files; 71 acquisitions/15 files; two separate CLI sites.

33a independently reviewed/queued:2CRUD, exactnestedgraph/nativeevent identities and properties checked before safe numeric/clock/ID representation normalization. No productioncorrection; no removalcredit beforeintegration.

19b final integration approval: Independent cumulative review against b7237c1: four non-context source/test blobs exactly match independently approved original tree9341421; context adaptation only adds optional IssueActivityMiddlewareRepository import/field. Five CRUD sites removed, zero acquisitions: optional model capability guards retained. Named generated operations preserve author union/filter selections, full Issue default closure projection, first-error behavior and middleware/delete/closure/activity/notification ordering. Prior 20 focused units and static evidence reused. Exact cumulative snapshot live log /tmp/runtime-slice19b-exact-live.log reports7 passed, zero failed/skipped/cancelled; diff check clean. Ledger totals328 CRUD/71 acquisitions consistent; queued33a manifest/hash recorded without removal credit. Mandatory cumulative hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice19b committed `7d001534d0441dda10bcf15104b778e118cd2a18` ([diff](https://github.com/gennit-project/multiforum-backend/commit/7d001534d0441dda10bcf15104b778e118cd2a18)), tree `749dbe4b86de8f2700224ffb4752c62c2c06db38`: lint, TypeScript and all2128 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice19b-exact-live.log. Independent approval recorded above.

### Slice 19c — Issue lock transitions

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 324 CRUD sites/66 files; 71 acquisitions/15 files; two separate CLI sites.

19c final integration approval: Independent cumulative review against7d00153: five non-factory source/test blobs exactly match independently approved original tree24604ec; shared factory cumulative change only replaces lockIssue/unlockIssue Issue arguments with zero-argument factories. Existing validation/auth/read catch boundaries, non-atomic read/check/write, explicit projections, identity update guard, nested graph/native events and write-notify-return semantics retained. Prior independent10 focused units/static evidence reused; exact cumulative /tmp/runtime-slice19c-exact-live.log reports10 passed, zero failed/skipped/cancelled, including assembled factory integration. Diff check clean. Four CRUD/zero acquisitions removed; ledger324 CRUD/71 acquisitions consistent. Mandatory cumulative hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice19c committed `c070e6a721dbc1bcf032d063b1e29a6607cd3140` ([diff](https://github.com/gennit-project/multiforum-backend/commit/c070e6a721dbc1bcf032d063b1e29a6607cd3140)), tree `33e941cd7d366be1fa251e9367c1b5de95dd4c1f`: lint, TypeScript and all2138 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice19c-exact-live.log. Independent approval recorded above.

### Slice 20 — Comment revision persistence

6 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 318 CRUD sites/64 files; 67 acquisitions/13 files; two separate CLI sites.

33b independently reviewed/queued:9CRUD, originalrecurrencescopes/overrideflags/25cap, transactionrollback and orderednativeevents/notificationeffects retained. No removalcredit beforeintegration.

20 final integration approval: Independent cumulative review againstc070e6a: six non-context source/test blobs exactly match approved original tree7528072; context adaptation only adds optional CommentRevisionRepository import/field. Reused original independent16 units and corrected DiscussionChannel fixture/default projection/native event evidence. Exact cumulative /tmp/runtime-slice20-exact-live.log reports20 passes, zero failed/skipped/cancelled. Original separate snapshot/create/existence/connect boundaries, attribution, old-text history, swallowed tracking failures and continued downstream effects retained; no deduplication redesign. Diff check clean. Six CRUD/four acquisitions removed; ledger318 CRUD/67 acquisitions consistent; queued33b approval/tree/hash recorded without removal credit. Mandatory cumulative hooks/build/circular and exact-SHA publication CI remain parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice20 committed `3e1283d2b3a147dfb116b388b16e985b6dccd85f` ([diff](https://github.com/gennit-project/multiforum-backend/commit/3e1283d2b3a147dfb116b388b16e985b6dccd85f)), tree `4bb4705142cdd8649cc45279135f533fe0262cce`: lint, TypeScript and all2150 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice20-exact-live.log. Independent approval recorded above.

### Slice 21a — Discussion revision persistence

10 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 308 CRUD sites/63 files; 64 acquisitions/12 files; two separate CLI sites.

21a final integration approval: Independent cumulative review versus3e1283d: four non-context source/test blobs exactly match independently approved treea2dccf7; context adaptation only adds optional DiscussionRevisionRepository import/field. Reused independent14 focused units and original live/static evidence. Exact cumulative /tmp/runtime-slice21a-exact-live.log reports9 passed, zero failed/skipped/cancelled. Title-before-body attribution, full production defaults, separate writes, swallowed helper failures, orphan revision behavior and outer editor failure suppression preserved; no dedupe/transaction redesign. Diff check clean; ten CRUD/three acquisitions removed and ledger308 CRUD/64 acquisitions consistent. Mandatory cumulative hooks remain parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice21a committed `e28de9924784de37369a0091925bb155a42d09fe` ([diff](https://github.com/gennit-project/multiforum-backend/commit/e28de9924784de37369a0091925bb155a42d09fe)), tree `baf110be1f7002edcc0deda5ec89b720577b4fa3`: lint, TypeScript and all2155 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice21a-exact-live.log. Independent approval recorded above.

### Slice 21b — Discussion revision middleware

2 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 306 CRUD sites/62 files; 62 acquisitions/11 files; two separate CLI sites.

33c independently reviewed/queued:8CRUD, original scopes/25cap/independent commits and orderednativeevents retained; exactsamegraphread parity and controlled nonsorted partial-failure input verify surviving identities without cross-allocation assumptions. No removalcredit beforeintegration.

21b final integration approval: Independent cumulative review againste28de99: all four source/test blobs exactly match approved original tree6736a61; no shared adapter changes. Standard full revision snapshot and narrow custom mention snapshot retain history-before-resolver, notifications-after-success, equal-content behavior and custom-wrapper exclusions. Original independent24 combined focused/static evidence reused. Exact live /tmp/runtime-slice21b-exact-live.log reports6 passed, zero failed/skipped/cancelled; diff check clean. Two CRUD/two acquisitions removed; ledger306 CRUD/62 acquisitions consistent and queued33c evidence recorded without removal credit. Mandatory cumulative hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice21b committed `c471ebb6c0a50856bc991a42ae85cc72c4e6ffa9` ([diff](https://github.com/gennit-project/multiforum-backend/commit/c471ebb6c0a50856bc991a42ae85cc72c4e6ffa9)), tree `0785519c2b81724fad1ec4c7811a6154b0e27594`: lint, TypeScript and all2159 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice21b-exact-live.log. Independent approval recorded above.

### Slice 22 — Event revision persistence

9 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 297 CRUD sites/60 files; 58 acquisitions/9 files; two separate CLI sites.

22 final integration approval: Independent cumulative review againstc471ebb: seven non-context source/test blobs exactly match approved original treeedfb505; context only adds optional EventRevisionRepository import/field. Original independent24 focused and live/static evidence reused. Exact cumulative /tmp/runtime-slice22-exact-live.log reports6 passed, zero failed/skipped/cancelled. Pre-resolver durable history, editor/prior-author attribution, separate helper failure catches, full production defaults/postcommit projection failures and later-notification behavior retained. Diff check clean; nine CRUD/four acquisitions removed; ledger297 CRUD/58 acquisitions consistent. Mandatory cumulative hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice22 committed `8fe3b98d5c9c565369c3a5ed371d4c6bd67886c4` ([diff](https://github.com/gennit-project/multiforum-backend/commit/8fe3b98d5c9c565369c3a5ed371d4c6bd67886c4)), tree `7783a275c319b5318ea3ce2b6141133982f267ee`: lint, TypeScript and all2169 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice22-exact-live.log. Independent approval recorded above.

### Slice 23a — Wiki revision persistence

7 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 290 CRUD sites/58 files; 53 acquisitions/7 files; two separate CLI sites.

34a independently reviewed/queued:7CRUD, download preparation/read authorization/default projections and separate scan update/notification/refetch boundaries preserved. Pipeline adapter forwarding retained until pipeline slices; no removal credit before integration.

23a final integration approval: Independent cumulative review against8fe3b98: six non-context source/test blobs exactly match approved original tree428308f; context only adds optional WikiRevisionRepository import/field with whitespace normalization. Original independent15 focused and24 live/static evidence reused. Exact cumulative /tmp/runtime-slice23a-exact-live.log reports10 passed, zero failed/skipped/cancelled. Original author/editReason/empty-content rules, title-before-body, separate failure boundaries/default projections and child result-shape/system attribution preserved. Diff check clean; seven CRUD/five acquisitions removed; ledger290 CRUD/53 acquisitions consistent, queued34a carries no removal credit. Mandatory cumulative hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice23a committed `52de2909c3f51393720bbdb585e6f21deab44f0c` ([diff](https://github.com/gennit-project/multiforum-backend/commit/52de2909c3f51393720bbdb585e6f21deab44f0c)), tree `6452f9e45a3911ff226dd2458e3587fe019ac0f6`: lint, TypeScript and all2175 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice23a-exact-live.log. Independent approval recorded above.

### Slice 23b — Revision redaction

2 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 288 CRUD sites/57 files; 53 acquisitions/7 files; two separate CLI sites.

23b final integration approval: Independent cumulative review against52de290: four non-factory source/test blobs exactly match approved original treee863e3b; factory delta only removes TextVersion forwarding for four revision types while preserving driver/type. Original independent16 focused, recovered static/live and existing factory evidence reused. Exact cumulative /tmp/runtime-slice23b-exact-live.log reports7 passed, zero failed/skipped/cancelled. Selected fields, find-before-target/authentication, owner/mod checks, existing target READ-session ownership, native events and temporal transaction-failure boundary preserved. Diff check clean; two shared CRUD/zero acquisitions removed; ledger288 CRUD/53 acquisitions consistent. Mandatory cumulative hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice23b committed `ae05cc46baa518a7dfb218365ec044dea445b67c` ([diff](https://github.com/gennit-project/multiforum-backend/commit/ae05cc46baa518a7dfb218365ec044dea445b67c)), tree `aafac617108c0401610f07a3ae3cc0a9d9ac91fa`: lint, TypeScript and all2178 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice23b-exact-live.log. Independent approval recorded above.

Published foundation milestone `3e1283d2b3a147dfb116b388b16e985b6dccd85f` passed exact-head [Tests CI39530552716](https://github.com/gennit-project/multiforum-backend/actions/runs/39530552716) and [container39530552572](https://github.com/gennit-project/multiforum-backend/actions/runs/39530552572), including all eight integration shards, unit/combined coverage, performance budgets and static/build gates.

Queued34a review correction: original approval withdrawn after the fixture used only the legacy raw-notification AUTHORED_DISCUSSION edge, leaving GraphQL Author null. Corrected fixture uses canonical POSTED_DISCUSSION, asserts non-null preparation/authority authors, and separately characterizes legacy raw notification edge presence/absence. Production unchanged. Independent review reapproved tree4c012a555d321159f01dbb31a1b6c4c797ce6720, patch7a4ff9b5d0a5a9643925a0c6b49925e4bba48b89fa6dced1bd4e7d642f9b9c34 after13correctedlive/types/lint passed. No inventory removal credit yet.

### Slice 24a — Event reports

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 284 CRUD sites/56 files; 53 acquisitions/7 files; two separate CLI sites.

24a final integration approval: Independent cumulative review againstae05cc4: four non-factory source/test blobs exactly match approved7626ffd; factory only removes Issue/Event forwarding for reportEvent retaining driver. Original independent7 focused/static/live evidence reused; exact cumulative live log reports6 passed zero failed/skipped/cancelled. Explicit selections/root limit, identity guards, separate counter allocation/create/update/activity boundaries and projection-error catches retained. Diff check clean;4CRUD/0acquisitions removed, ledger284/53 consistent. Corrected34a queued tree/hash/evidence recorded with no removal credit. Mandatory hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice24a committed `829798d4a8b6b20f08605f5d634fb4782fc7ab32` ([diff](https://github.com/gennit-project/multiforum-backend/commit/829798d4a8b6b20f08605f5d634fb4782fc7ab32)), tree `5922adda969a29a6975e6056f3cd659ec82a4be7`: lint, TypeScript and all2182 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice24a-exact-live.log. Independent approval recorded above.

### Slice 24b — Comment reports

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 280 CRUD sites/55 files; 53 acquisitions/7 files; two separate CLI sites.

34b independently reviewed/queued:7CRUD, owner/mod authorization and validation retained; separate label/history/moderation operations, added-before-removed history, independently swallowed history/moderation failures and committed projection errors characterized. Corrected34a baseline inherited without changing approved34b delta. No removal credit before integration.

24b final integration approval: Independent cumulative review against829798d: four non-factory source/test blobs identical to approvedff852077; factory only removes Issue/Comment forwarding retaining driver. Prior independent12 focused/static evidence reused; exact live7 passed zero failed/skipped/cancelled. Unconditional author lookup, both union identities, identity guards, separate counter/create/update/activity boundaries and projection failures preserved. Diff check clean;4CRUD/0acquisitions, ledger280/53 consistent; corrected34b queued metadata carries no removal credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice24b committed `e63b7872fa64781781d9decee386937f8afd7efd` ([diff](https://github.com/gennit-project/multiforum-backend/commit/e63b7872fa64781781d9decee386937f8afd7efd)), tree `8f246ba90d9daa0162cb4dfd590c26a5038b4916`: lint, TypeScript and all2190 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice24b-exact-live.log. Independent approval recorded above.

### Slice 24c — Discussion reports

5 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 275 CRUD sites/54 files; 53 acquisitions/7 files; two separate CLI sites.

24c final integration approval: Independent cumulative review againste63b787: four non-factory blobs exactly match approved9d00306; factory only removes Issue/Discussion forwarding retaining driver. Optional Channel capability acquisition retained. Prior independent5 focused/static evidence reused; exact live7 passed zero failed/skipped/cancelled. Issue-first/new-only target lookup, allocation and optional channel-read catch boundaries, identity reconnect, detailed create versus generic update failures preserved. Diff check clean;5CRUD/0acquisitions, ledger275/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice24c committed `0756cf7c138880d0a89154d3587db59f64de4f2a` ([diff](https://github.com/gennit-project/multiforum-backend/commit/0756cf7c138880d0a89154d3587db59f64de4f2a)), tree `d13671608806a6998f00bdbca9be7c669303632e`: lint, TypeScript and all2192 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice24c-exact-live.log. Independent approval recorded above.

### Slice 24d — Channel reports

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 271 CRUD sites/53 files; 53 acquisitions/7 files; two separate CLI sites.

24d final integration approval: Independent cumulative review against0756cf7: four non-factory source/test blobs exactly match approved0d951828; factory only removes Issue/Channel forwarding retaining driver. Prior independent12 focused/static evidence reused; exact live6 passed zero failed/skipped/cancelled. Channel-before-issue lookup, null server scope/counter, identity guards, flags, selected projections and detailed-create/generic-update boundaries retained. Diff check clean;4CRUD/0acquisitions, ledger271/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice24d committed `1f5df204cc76f9005c797ec97becb1ecb5c3d815` ([diff](https://github.com/gennit-project/multiforum-backend/commit/1f5df204cc76f9005c797ec97becb1ecb5c3d815)), tree `bd30811e8ca643de43c85dc755cbeccefcff2a77`: lint, TypeScript and all2204 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice24d-exact-live.log. Independent approval recorded above.

### Slice 25a — Image reports

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 267 CRUD sites/52 files; 53 acquisitions/7 files; two separate CLI sites.

25a final integration approval: Independent cumulative review against1f5df204: four non-factory blobs identical to approveda473bf7; factory only removes Issue/Image forwarding retaining driver. Prior independent5 focused/static evidence reused; exact live7 passed zero failed/skipped/cancelled including restored immutable-update guard. Target/scope/counter/create-append boundaries, nested MODERATED_COMMENT author graph and native projection-failure durability retained. Diff check clean;4CRUD/0acquisitions, ledger267/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice25a committed `7b6bb93e281d1aa2bfd63f2c0b8954e8a41e6f14` ([diff](https://github.com/gennit-project/multiforum-backend/commit/7b6bb93e281d1aa2bfd63f2c0b8954e8a41e6f14)), tree `6a06b28803a946e7ee9cf4ac3986a95ca048f03e`: lint, TypeScript and all2209 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice25a-exact-live.log. Independent approval recorded above.

### Slice 25b — Profile picture reports

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 263 CRUD sites/51 files; 53 acquisitions/7 files; two separate CLI sites.

25b final integration approval: Independent cumulative review against7b6bb93: four non-factory blobs identical to approved649b62c; factory only removes Issue/User forwarding retaining driver. Prior independent5 focused/static evidence reused; exact live6 passed zero failed/skipped/cancelled including immutable-update rejection. Profile identity/scope/counter, selected projections, create-append catches and durable nested activity/native-event behavior retained. Diff check clean;4CRUD/0acquisitions, ledger263/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice25b committed `c945f093b387cf5491322643c91d09d72980099c` ([diff](https://github.com/gennit-project/multiforum-backend/commit/c945f093b387cf5491322643c91d09d72980099c)), tree `5c2898a1be9f4677d418de0d69ec2de8f2f627eb`: lint, TypeScript and all2214 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice25b-exact-live.log. Independent approval recorded above.

### Slice 25c — Channel image reports

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 259 CRUD sites/50 files; 53 acquisitions/7 files; two separate CLI sites.

36a independently reviewed and queued: 13 CRUD sites; fixed named registry operations preserve projections, coercion, orphan ordering, partial commits and catch boundaries. Eight focused, nine new live and three existing live checks plus corrected static checks passed. No removal credit before integration.

25c final integration approval: Independent cumulative review againstc945f09: four non-factory blobs identical to previously approvedb6e18dcb recorded in ledger; factory only removes Issue/Channel forwarding retaining driver. Inspected preserved independent5 units/corrected7 live and bounded original production diff: identity attachment and prewrite immutable-update assertion retained with original selections, channel target/server scope/counter and create-append catches. Exact cumulative live7 passed zero failed/skipped/cancelled. Diff check clean;4CRUD/0acquisitions, ledger259/53 consistent; queued36a no removal credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice25c committed `58bc897e2f08412838d6c344a23d1bdabd295803` ([diff](https://github.com/gennit-project/multiforum-backend/commit/58bc897e2f08412838d6c344a23d1bdabd295803)), tree `1f3fe0c7cbf7dbddd08f50ab8de48c21f365c2d1`: lint, TypeScript and all2219 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice25c-exact-live.log. Independent approval recorded above.

### Slice 25d — Wiki edit reports

5 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 254 CRUD sites/49 files; 53 acquisitions/7 files; two separate CLI sites.

25d final integration approval: Independent cumulative review against58bc897: four non-factory blobs identical to prior approved8fc2ca25; factory only removes Issue/WikiPage/TextVersion forwarding retaining driver. Inspected preserved independent6 units/final14 live/static exits and bounded original production diff. Identity attachment/prewrite immutable guard, page/revision attribution and scope, counter outside create catch, explicit selections and create-append error/durability boundaries preserved. Exact cumulative live8 passed zero failed/skipped/cancelled. Diff check clean;5CRUD/0acquisitions, ledger254/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice25d committed `9debcdf6d3e253b15e209c22a723c8a8c3a23654` ([diff](https://github.com/gennit-project/multiforum-backend/commit/9debcdf6d3e253b15e209c22a723c8a8c3a23654)), tree `89d0650bacd922167523f94bec5772ea316a09c6`: lint, TypeScript and all2225 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice25d-exact-live.log. Independent approval recorded above.

### Slice 26 — Channel moderation

9 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 245 CRUD sites/47 files; 53 acquisitions/7 files; two separate CLI sites.

36b independently reviewed and queued: 9 CRUD sites; fixed named installation operations preserve registry/integrity/manifest checks, default selections, independent writes, secret carry-over ordering and failure prefix. Ten focused, eleven new live and four existing live checks plus static checks passed. No removal credit before integration.

26 final integration approval: Independent cumulative review against9debcdf6: five non-factory source/test blobs identical to approved05ca0eab; factory only removes Issue/Channel forwarding from lock/unlock retaining driver. Prior independent26 focused and corrected6live/static evidence reused. Exact cumulative6live passed zero failed/skipped/cancelled. Identity protection/full defaults, existing/supplied issue handling, counter/catch boundaries, repeated actions and raw-admin notification session/error/close ordering retained. Diff check clean;9CRUD/0acquisitions, ledger245/53 consistent, queued36b no removal credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice26 committed `7721da49786f1253f8303cd59280dbd022cdd246` ([diff](https://github.com/gennit-project/multiforum-backend/commit/7721da49786f1253f8303cd59280dbd022cdd246)), tree `6eb8fb3e500480a548d9b281327aa1176bb58504`: lint, TypeScript and all2251 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice26-exact-live.log. Independent approval recorded above.

### Slice 27 — Comment moderation

11 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 234 CRUD sites/45 files; 53 acquisitions/7 files; two separate CLI sites.

27 final integration approval: Independent cumulative review against7721da49: six non-factory blobs identical to approved5dd62dfd; factory removes Issue/Comment forwarding and adds required unarchive driver only. Ledger confirms final independent33focused approval despite stale handoff wording; original12live/static evidence reused. Exact cumulative6live passed zero failed/skipped/cancelled. Identity/full Comment defaults, counter catch, activity/close/subscriber/state/author order and legacy moderator fragment error retained. Diff check clean;11CRUD/0acquisitions, ledger234/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice27 committed `ad6778bb194f89d667685e350e15c7d4b8e7bde8` ([diff](https://github.com/gennit-project/multiforum-backend/commit/ad6778bb194f89d667685e350e15c7d4b8e7bde8)), tree `4819f0c074cda9bc169f5d26543bd4c020f5eb92`: lint, TypeScript and all2282 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice27-exact-live.log. Independent approval recorded above.

### Slice 28a — Discussion moderation

9 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 225 CRUD sites/43 files; 53 acquisitions/7 files; two separate CLI sites.

28a final integration approval: Independent cumulative review againstad6778bb: six non-factory blobs identical to approveda956a99b; factory only removes discussion moderation model forwarding and supplies unarchive driver. Prior independent19focused/corrected live/static evidence reused; exact6live passed zero failed/skipped/cancelled. Explicit/full channel defaults, protected issue identity, allocation/catch boundaries and subscriber-before-state/author-after-state effects retained, including postcommit failure behavior. Diff check clean;9CRUD/0acquisitions, ledger225/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice28a committed `66893c2802db21b955ef2c3dd1b8ca0c3daf939d` ([diff](https://github.com/gennit-project/multiforum-backend/commit/66893c2802db21b955ef2c3dd1b8ca0c3daf939d)), tree `b1d6269a6d12dda65287552efefa5afb9f64ac23`: lint, TypeScript and all2299 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice28a-exact-live.log. Independent approval recorded above.

### Slice 28b — Event moderation

9 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 216 CRUD sites/41 files; 53 acquisitions/7 files; two separate CLI sites.

28b final integration approval: Independent cumulative review against66893c28: six non-factory blobs identical to approved1a00723c; factory removes only event moderation model forwarding and supplies unarchive driver. Prior independent20focused/final12live/static evidence reused; exact cumulative6live passed zero failed/skipped/cancelled. canHideEvent authorization, corrected POSTED_BY positive author fixture, protected identity/full defaults and ordered partial-write/notification behavior retained. Diff check clean;9CRUD/0acquisitions, ledger216/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice28b committed `c9e9ca7ce66d627a0468102dea25a5aa7046244d` ([diff](https://github.com/gennit-project/multiforum-backend/commit/c9e9ca7ce66d627a0468102dea25a5aa7046244d)), tree `ed12ff1c984206b541f3d28a57066e4864b32216`: lint, TypeScript and all2317 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice28b-exact-live.log. Independent approval recorded above.

### Slice 29a — Image moderation

11 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 205 CRUD sites/39 files; 53 acquisitions/7 files; two separate CLI sites.

39 independently reviewed and queued:6CRUD. Review rejected an incorrect assumption that bot-report middleware used the mutation-resolver Issue proxy. Corrected patch preserves its raw-model path, including production-schema coercion failure after creation and original standalone-schema success. Eleven focused,21live and static checks passed; no removal credit before integration.

29a final integration approval: Independent cumulative29a review againstc9e9ca7: five non-factory blobs matched approveda6bb708f before EOF-only test cleanup; factory narrowly removes Issue/Image forwarding and adds unarchive driver. Prior ledger final approval/33focused/10live/static evidence reused. Exact cumulative6live passed zero failed/skipped/cancelled on identical executable source; refreeze delta verified only trailing blank-line removal and approved39 queue docs. Full Image defaults, identity guards, scope/counter/catch boundaries and ordered notifications/partial-write effects retained; storage remains untouched. Diff check now clean;11CRUD/0acquisitions, ledger205/53 consistent; queued39 no removal credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice29a committed `3ad53a8929631de0176481d3fade46368ebd1e74` ([diff](https://github.com/gennit-project/multiforum-backend/commit/3ad53a8929631de0176481d3fade46368ebd1e74)), tree `2611c89107a4d425c521075d635ca4cd428a1b08`: lint, TypeScript and all2350 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice29a-exact-live.log. Independent approval recorded above.

### Slice 29b — Permanent image flags

6 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 199 CRUD sites/38 files; 53 acquisitions/7 files; two separate CLI sites.

29b final integration approval: Independent cumulative review against3ad53a89: four non-factory blobs identical to approved5b07717f; factory only removes Issue/Image forwarding retaining driver. Ledger final approval and prior16focused/corrected8live/static evidence reused. Exact cumulative5live passed zero failed/skipped/cancelled. Server scope/already-removed validation/counter boundaries, protected issue identity, removal-close-subscriber-state order and durable projection failures retained; stored objects/URLs unchanged. Diff check clean;6CRUD/0acquisitions, ledger199/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice29b committed `e863538e62fbe2773521518461fb621a6ba61d8f` ([diff](https://github.com/gennit-project/multiforum-backend/commit/e863538e62fbe2773521518461fb621a6ba61d8f)), tree `7ba7417163742edd58c66ae47066c43b1fc4e255`: lint, TypeScript and all2366 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice29b-exact-live.log. Independent approval recorded above.

### Slice 30 — Suspension writes

7 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 192 CRUD sites/36 files; 53 acquisitions/7 files; two separate CLI sites.

30 final integration approval: Independent cumulative review againste863538: ten non-factory/context blobs identical to approveda211f02b; context only adds optional SuspensionWriteRepository import/field, factory drops suspension model arguments preserving capability flags. Prior23focused/14existing live/final10live/static evidence reused. Exact cumulative10live passed zero failed/skipped/cancelled. Identity protection/full defaults, separate writes/notification/scope-owner/cleanup boundaries and partial failures preserved; original response-only ActivityFeed normalization leaves ordered native events strict. Diff check clean;7CRUD/0acquisitions, ledger192/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice30 committed `7c246fb6976b1ea5dd6cfcb1973ea02b00ee91f6` ([diff](https://github.com/gennit-project/multiforum-backend/commit/7c246fb6976b1ea5dd6cfcb1973ea02b00ee91f6)), tree `2e5e85f1071bceee6e21bafd117b9f932bf064f2`: lint, TypeScript and all2382 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice30-exact-live.log. Independent approval recorded above.

### Slice 31a — Discussion creation

3 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 189 CRUD sites/35 files; 53 acquisitions/7 files; two separate CLI sites.

CLI pipeline migration independently reviewed and queued: two separate CLI CRUD sites, zero runtime credit. Private standalone schema preserves legacy response/error behavior; actual CLI never executed. Final cumulative gates pending.

31a cumulative live first run:3/4passed; exact baseline/candidate comparison passed, but a redundant expected literal assertion compared GraphQL null-prototype records to plain objects. Corrected only that literal comparison through full JSON value conversion, retaining exact baseline/candidate comparison. Targeted rerun and renewed independent review required.

31a final integration approval: Independent cumulative31a review against7c246fb: seven non-factory source/test blobs originally identical to approved57c88c13, factory narrowly removes unused Discussion from seed/shareCollection while retaining plugin capability forwarding. New refreeze changes only expected-literal test representation and documentation; exact old/new deep comparison remains. Original22focused/8live/static reused. Cumulative first run3/4 passed; corrected attached-file targeted1/1 now passes with zero failures/skips/cancellations. No production changes or weakened field comparison. Creation/refetch/file selections, raw channel/session/collection failure order preserved. Diff check clean;3CRUD/0acquisitions, ledger189/53 and separate queuedCLI consistent. Prior test-only rejection superseded for this tree; mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice31a committed `1b1f7a93f45f1a250ca5b92f31de4cad423acdff` ([diff](https://github.com/gennit-project/multiforum-backend/commit/1b1f7a93f45f1a250ca5b92f31de4cad423acdff)), tree `8b04352c818a5f8452a306c4dd042e0cc60f222f`: lint, TypeScript and all2382 units passed; Cumulative original live3/4passed, then corrected expected-literal assertion targeted1passed; exact baseline/candidate comparison unchanged. See /tmp/runtime-slice31a-corrected-live.log. Independent approval recorded above.

### Slice 31b — Discussion update

3 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 186 CRUD sites/34 files; 53 acquisitions/7 files; two separate CLI sites.

31b final integration approval: Independent cumulative31b review against1b1f7a93: seven non-factory blobs identical to approvedd39f78ba including executor/tests; factory removes only Discussion forwarding. Prior27focused/final5new+6existinglive/static evidence reused. Exact cumulative11live passed zero failed/skipped/cancelled. Optional caller-owned executionContext forwarding preserves database session config/first-error handling and transaction ownership; pretransaction snapshot, managed retry/rollback, postcommit history/plugins/refetch order retained.31a corrected attached-file fixture remains untouched. Diff check clean;3CRUD/0acquisitions, ledger186/53 consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

31b first mandatory hooks failed two older download-scan unit fixtures still injecting a Discussion model. Corrected only those fixtures to inject the named repository port with identical responses; plugin trigger assertions retained. Original11livepassed; renewedreview and fullhooks required.

31b final integration approval: Renewed exact review against prior approved 51ff92d282b53c5c0fb4e3075b7228c5845bbb5f: only two stale download-scan unit fixtures now inject named repository methods with equivalent empty-update/id-read responses; trigger assertions unchanged, plus accurate ledger note. No executable production changes. Corrected focused 3/3 passed; original exact cumulative 11/11 live evidence remains applicable, zero failures/skips/cancellations. Diff check clean. Prior cumulative scope/transaction/default-projection review retained; mandatory full hooks remain parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice31b committed `50322bc48b26959879c39eff435611d29821deb9` ([diff](https://github.com/gennit-project/multiforum-backend/commit/50322bc48b26959879c39eff435611d29821deb9)), tree `cf9afb9292bb75367143a5324cc889b467efa93a`: lint, TypeScript and all2383 units passed; Eleven cumulative live passed; after test-only stale unit fixture correction three focused passed and renewed independent review; see /tmp/runtime-slice31b-exact-live.log. Independent approval recorded above.

### Slice 32 — Event creation and update

5 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 181 CRUD sites/32 files; 53 acquisitions/7 files; two separate CLI sites.

Pipeline driver-forwarding foundation independently reviewed and queued:46focused,2live and static checks passed. Zero CRUD credit. Explicit configured-driver identity retained across resolver, scheduled campaign and watchdog entry points. No database operation or lease changes.

44a pipeline result notification repository independently reviewed and queued:4CRUD,27focused,8live and static checks passed. Preserves absent-User guard, configured driver, separate claim/write ordering and failure contract. Raw subscription node/relationship IDs checked before normalization. No credit before integration.

32 final integration approval: Independent cumulative review against 50322bc48b26959879c39eff435611d29821deb9. Six resolver/repository/test blobs are identical to original independently approved 939e53e6; factory only removes three unused Event forwards. Seeder preserves 31a Discussion repository cleanup and replaces Event helper dependency with configured-driver repository. 31b caller-owned transaction executor remains unchanged; original default projections, managed transaction/rollback boundaries, per-item creation failures and postcommit history/notification/refetch order preserved. Original six focused/static evidence reused; exact cumulative 14 live passed, zero failures/skips/cancellations. Diff check clean. Ledger five CRUD/zero acquisitions, 181 remaining CRUD/53 acquisitions; queued wiring/44a receive no removal credit. Mandatory hooks remain required.; live parity passed on identical production sources before this documentation-only update.

Slice32 committed `9ac1d2dbfc650cb4afa2ededacb383bf118429ae` ([diff](https://github.com/gennit-project/multiforum-backend/commit/9ac1d2dbfc650cb4afa2ededacb383bf118429ae)), tree `f29c32553f3e8d44dc0213ac503dbb11e2053ad2`: lint, TypeScript and all2383 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice32-exact-live.log. Independent approval recorded above.

CLI migration integrated: two separate CLI CRUD sites removed, no runtime credit. Cumulative live/review/hooks pending. Actual CLI never executed.

CLI migration committed a860f26debcf4d6f1d0f448d53614baffdd73255: five cumulative live tests, lint,TypeScript and2386units passed; independent integration approval recorded.

### Slice 33a — Event series creation

2 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 179 CRUD sites/31 files; 53 acquisitions/7 files; zero separate CLI CRUD sites.

40a lease helpers independently reviewed and queued:6CRUD;30focused plus overlapping6lease units,8live and static checks passed. Same independent write/partial-failure contracts and heartbeat boundaries. Sequential stale-owner evidence only; no concurrent atomicity redesign. No credit before integration.

33a final integration approval: Independent cumulative33a review against a860f26. Four nonfactory blobs identical to approved b73c53b6; factory removes only unused Event/Tag forwards. Original10focused/6existinglive/4correctednewlive/static evidence reused; exact cumulative4live passed zero failures/skips/cancellations. Caller transaction, nested generated inputs, postcommit refetch, full raw native event/graph parity retained; shared31/32 sources untouched. Diff check clean. Inventory179CRUD/31files includes178typed sites/30files plus explicitly tracked structural buildBotInvocationContext Comment.find;53acquisitions unchanged. Reviewed pending documentation-only correction changes stale two-CLI prose to zero CLI sites; parent will stage with review. Queued40a receives no removal credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

33a mandatory TypeScript gate caught one stale EventSeries property forwarded by cumulative factory integration. Removed that unused forwarding; repository/resolver code unchanged. Renewal review and full hooks required. Original4exactlive passed.

33a final integration approval: Renewed exact33a review versus approved6606e102: removes only unused EventSeries forwarding from creation factory, whose Input accepts driver/optional repository. Repository/resolver/test sources unchanged; original exact4live and prior10focused/6existinglive/static evidence retained. Documentation records prior review, corrects zero CLI count and accurately states mandatory TypeScript failure. Corrected TypeScript exit0 confirmed by parent session88320; diff check clean. Prior scope/transaction/native-event/default/input parity review and179CRUD/53acquisition inventory remain applicable. Full mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice33a committed `23338126449c166ab296163c1e352bdb7da3445b` ([diff](https://github.com/gennit-project/multiforum-backend/commit/23338126449c166ab296163c1e352bdb7da3445b)), tree `87f14ee8b25c22923c7261d62c6adbd96393d273`: lint, TypeScript and all2386 units passed; Four cumulative live passed; unused factory EventSeries forwarding removed after TypeScript gate, renewed review and full hooks; see /tmp/runtime-slice33a-exact-live.log. Independent approval recorded above.

### Slice 33b — Event series updates

9 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 170 CRUD sites/30 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

40b attempt tracking independently reviewed and queued:4CRUD;39focused,12live and static checks passed. Same independent write/partial-failure contracts and full default projections; no atomic sequence redesign. No credit before integration.

33b final integration approval: Independent cumulative33b review against23338126449c166ab296163c1e352bdb7da3445b. Five nonfactory source/test blobs exactly match independently approvedc31abc6a; factory removes only unused Event/EventSeries forwards, matching driver/optional repository Input. Prior13focused/static evidence reused; exact cumulative21live passed zero failures/skips/cancellations. Same caller transactions/retries, full default selections, three scopes/override flags, nested25cap, channel writes and postcommit notification behavior preserved; prior33a factory correction and31/32 shared changes retained. Diff check clean. Ledger9CRUD/0acquisitions,170remainingCRUD including structural adapter/53acquisitions/0CLI; queued40b receives no credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice33b committed `adba3d728dde2b37c8b1427209efb3875b76d164` ([diff](https://github.com/gennit-project/multiforum-backend/commit/adba3d728dde2b37c8b1427209efb3875b76d164)), tree `086fa79ae188a6252741ad3b3016464389c3655e`: lint, TypeScript and all2386 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice33b-exact-live.log. Independent approval recorded above.

### Slice 33c — Event series deletion

8 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 162 CRUD sites/29 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

33c final integration approval: Independent cumulative33c review againstadba3d728dde2b37c8b1427209efb3875b76d164. Four nonfactory blobs identical to independently approveda0171c05; factory removes only unused Event/EventSeries forwards, matching driver/optional repository Input. Original11focused/static and repaired partial-failure evidence reused; exact cumulative20live passed zero failures/skips/cancellations. Snapshot order/nested25, independent delete commits, supported DeleteInfo, second-response failure prefix, quarantine/error boundaries and raw native event/remaining graph checks preserved; no sorting/transaction redesign. Prior33a/b and31/32 shared changes retained. Diff check clean. Ledger8CRUD/0acquisitions,162remainingCRUD including structural adapter/53acquisitions/0CLI consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice33c committed `e1c52be1b11946141e753ff89f116caf1e28213b` ([diff](https://github.com/gennit-project/multiforum-backend/commit/e1c52be1b11946141e753ff89f116caf1e28213b)), tree `9362c70f5de889994e3caeb3812526f03b210308`: lint, TypeScript and all2386 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice33c-exact-live.log. Independent approval recorded above.

### Slice 34a — Download review and preparation

7 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 155 CRUD sites/26 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

34a final integration approval: Independent cumulative34a review againste1c52be1b11946141e753ff89f116caf1e28213b. Eight nonfactory source/test blobs identical to corrected approved4c012a55; factory removes unused clearScan model and forwards configured driver to requestReview. Preparation pipeline capability/model forwards retained. Corrected canonical POSTED_DISCUSSION author assertions and separate legacy AUTHORED notification edge cases preserved. Original16focused/static evidence reused; exact cumulative13live passed zero failures/skips/cancellations, including full defaults, authorization reads and committed projection failures/notification boundaries. No transaction/order/routing changes; prior31-33 adaptations retained. Diff check clean. Ledger7CRUD/0acquisitions,155remainingCRUD including structural adapter/53acquisitions/0CLI consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice34a committed `58aa682b8ff58f50601d6e1d8dc74e602ac030c4` ([diff](https://github.com/gennit-project/multiforum-backend/commit/58aa682b8ff58f50601d6e1d8dc74e602ac030c4)), tree `4e9385db4de9c2a7a23a9ab3070fda67d6ed47ca`: lint, TypeScript and all2386 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice34a-exact-live.log. Independent approval recorded above.

### Slice 34b — Download label persistence

7 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 148 CRUD sites/25 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

41 download execution independently reviewed and queued:12CRUD;21focused,8live and static checks passed. Primitive persistence event/graph parity plus actual trigger smoke; external providers mocked/guarded. No credit before integration.

34b final integration approval: Independent cumulative34b review against58aa682b8ff58f50601d6e1d8dc74e602ac030c4. Four nonfactory source/test blobs identical to corrected-base approved23ba268c; factory forwards configured driver instead of five unused model inputs and removes three now-unused destructures, with no remaining references. Corrected34a fixture/context changes retained. Original6focused/static evidence reused; exact cumulative18live passed zero failures/skips/cancellations, covering owner/mod permission and label validation plus default/coercion/committed failure and raw native event parity. Adds-before-removes, separate label/history/moderation commits and independently swallowed failures unchanged. Diff check clean. Ledger7CRUD/0acquisitions,148remainingCRUD including structural adapter/53acquisitions/0CLI consistent; queued41 gets no credit and evidence scope accurate. Mandatory hooks/build remain required.; live parity passed on identical production sources before this documentation-only update.

Slice34b committed `0556cc6e5e42cb8fa78440ce590c4d0056c9fd2f` ([diff](https://github.com/gennit-project/multiforum-backend/commit/0556cc6e5e42cb8fa78440ce590c4d0056c9fd2f)), tree `282b898a0f9bf4d749ca21a1f43892e3b324a09c`: lint, TypeScript and all2392 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice34b-exact-live.log. Independent approval recorded above.

### Slice 36a — Plugin registry refresh

13 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 135 CRUD sites/24 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

42 channel execution independently reviewed and queued:13CRUD;15focused,8live and static checks passed. Primitive persistence event/graph parity plus actual trigger validation-failure parity; downstream execution mocked; external providers mocked/guarded. No credit before integration.

40c watchdog recovery independently reviewed and queued:4CRUD;4focused,7live and static checks passed. Same expiry/partial-failure contracts and unbounded reads; no timer/recovery redesign. No credit before integration.

36a final integration approval: Independent cumulative36a review against0556cc6e5e42cb8fa78440ce590c4d0056c9fd2f. Four nonfactory blobs identical to independently approvedc8bf5cdb; factory replaces three unused model forwards with configured driver, matching Input. Original8focused/static evidence reused; exact cumulative12live passed zero failures/skips/cancellations including actual registry parity and existing mocked HTTP/tarball cases. Exact reads/defaults, orphan repair before registry loop, per-version/outer catch and final-refetch fallback, metadata serialization/processedAnyVersion unchanged. Diff check clean; ledger13CRUD/0acquisitions,135remainingCRUD including structural adapter/53acquisitions/0CLI. Queued40c/42 accurately recorded without removal credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice36a committed `896d84346b5abf6ef4433309d2b101609f6bdea4` ([diff](https://github.com/gennit-project/multiforum-backend/commit/896d84346b5abf6ef4433309d2b101609f6bdea4)), tree `833f471f0573e21555060cfe3a2256350f209dd5`: lint, TypeScript and all2400 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice36a-exact-live.log. Independent approval recorded above.

### Slice 37a — Server plugin secrets

5 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 130 CRUD sites/22 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

43 comment execution independently reviewed and queued:11CRUD;16focused,7initiallive plus2correctedtargetedlive and static checks passed. Primitive persistence event/graph parity plus actual trigger smoke; external providers mocked/guarded. No credit before integration.

37a final integration approval: Independent cumulative37a review against896d84346b5abf6ef4433309d2b101609f6bdea4. Preserved review_slice1 approval/recovery and20unit/4secret+4installlive/static ledger evidence reused; original patch SHA25646b01e962456107154c40f6f5ef2316bdd8467a44a8e928786e6a4fea6844db6 verified. All nine nonfactory blobs match prepared patch new-blob IDs; cumulative factory only replaces ServerSecret forwards with driver for install/setter. Inspected default projections, encryption-before-lookup, validation reset, sequential rename and install/apply context.driver wiring; error wrapping/independent commits retained. Exact cumulative8live passed zero failures/skips/cancellations including synthetic encryption and carry-settings rename. Diff check clean. Ledger5CRUD/0acquisitions,130remainingCRUD including structural adapter/53acquisitions/0CLI; corrected43 queue evidence accurate without credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice37a committed `9a2dd6fa511a8cce8bd99ff63b8df85a7b0e0f64` ([diff](https://github.com/gennit-project/multiforum-backend/commit/9a2dd6fa511a8cce8bd99ff63b8df85a7b0e0f64)), tree `b27933463d02ff3a27b6fdfe0f8887c2703118d5`: lint, TypeScript and all2404 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice37a-exact-live.log. Independent approval recorded above.

### Slice 36b — Plugin installation

9 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 121 CRUD sites/21 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

44b pipeline start controls independently reviewed and queued:6CRUD;24focused,5live and static checks passed. Authentication/owner/mod checks, runner and refetch ordering preserved. No credit before integration.

36b final integration approval: Independent cumulative36b review against9a2dd6fa511a8cce8bd99ff63b8df85a7b0e0f64. Four nonfactory source/test blobs identical to approved539815eb; factory removes only unused Plugin/PluginVersion/ServerConfig forwards, matching driver/repository Input.37a secret migration repository and applyPluginConfiguration context.driver composition retained. Prior10focused/static evidence reused; exact cumulative15live passed zero failures/skips/cancellations including4existing mocked installs/secret rename and11new actual install parity/default/coercion cases. Integrity/manifest checks, metadata/settings/secret migration ordering, independent commits and projection failure prefixes unchanged. Diff check clean. Ledger9CRUD/0acquisitions,121remainingCRUD including structural adapter/53acquisitions/0CLI; queued44b accurate without credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice36b committed `9f814bf42b0104147b9119f070fec816856186ec` ([diff](https://github.com/gennit-project/multiforum-backend/commit/9f814bf42b0104147b9119f070fec816856186ec)), tree `f28a7cae8ba75941fcb38fc958a1d2bc75973a01`: lint, TypeScript and all2414 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice36b-exact-live.log. Independent approval recorded above.

### Slice 37b1 — Server plugin pipelines

2 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 119 CRUD sites/20 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

44c pipeline rerun controls independently reviewed and queued:4CRUD;16focused,9live and static checks passed. Eligibility gates, timestamp arithmetic and retry metadata order preserved. No credit before integration.

37b1 final integration approval: Independent cumulative37b1 review against9f814bf42b0104147b9119f070fec816856186ec. Preserved review_slice1 ledger/13independentunit/4strengthenedlive/static evidence reused; patch SHA2569e606f203ce51ffa2cf0b42a7cec426d23c46bd5d1ad4d4458766dc083420893 verified. Four nonshared blobs match prepared new-blob IDs. Factory replaces ServerConfig forwarding with driver; apply composition passes context.driver while retaining37a install/secret and36b changes. Original validation/normalization/randomUUID/default handling, unbounded current read, exact full production update selection and postcommit projection error behavior unchanged. Exact cumulative4live passed zero failures/skips/cancellations. Diff check clean. Ledger2CRUD/0acquisitions,119remainingCRUD including structural adapter/53acquisitions/0CLI; queued44c accurate without credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice37b1 committed `316dc0c1105bf0041a2b11899d49cc33d3e23a3a` ([diff](https://github.com/gennit-project/multiforum-backend/commit/316dc0c1105bf0041a2b11899d49cc33d3e23a3a)), tree `f9a850c1d5be58457fd9af6cadbaca241af2375f`: lint, TypeScript and all2417 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice37b1-exact-live.log. Independent approval recorded above.

### Slice 37b2 — Server plugin enablement

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 115 CRUD sites/19 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

44d download scan retry controls independently reviewed and queued:4CRUD;6focused,6live and static checks passed. Owner/mod gates and latest attempt delegation/refetch order preserved. No credit before integration.

37b2 final integration approval: Independent cumulative37b2 review against316dc0c1105bf0041a2b11899d49cc33d3e23a3a. Five nonshared source/test blobs identical to approved2fe45df9; factory removes unused models and forwards driver; apply forwards context.driver while retaining37a/b1/36b integration. Prior13focused/4existingfactorylive/finalstatic evidence reused; exact cumulative7live passed zero failures/skips/cancellations. Previously authorized two-read/three-interpolation variable correction retained exactly: version and stored IDs including quotes/backslashes treated as data. No further behavior changes; optional secrets on enable, unbounded reads, settings validation/null serialization/full defaults and committed projection-failure errors unchanged. Diff check clean. Ledger4CRUD/0acquisitions,115remainingCRUD including structural adapter/53acquisitions/0CLI; queued44d accurate without credit. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice37b2 committed `500ae5da5ddcbd55127c7de66d4d938a8481ed0e` ([diff](https://github.com/gennit-project/multiforum-backend/commit/500ae5da5ddcbd55127c7de66d4d938a8481ed0e)), tree `ca5eea9eebfa38903ea469e4873ebe061acc38ff`: lint, TypeScript and all2428 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice37b2-exact-live.log. Independent approval recorded above.

### Slice 37c — Channel plugin pipelines

5 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 110 CRUD sites/18 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

37c final integration approval: Independent cumulative37c review against500ae5da5ddcbd55127c7de66d4d938a8481ed0e. Preserved review_recovery approval/7units/4live/static evidence reused; original SHA256e6dfab0d9ebe665468ba80c0e522581b032d953410479babf089469496d31960 verified. Five nonfactory blobs match prepared new-blob IDs; factory replaces only ServerConfig with driver and retains Channel/User for bot sync. Exact projections/defaults, configuration save before bot sync, sequential orphan deprecation then disconnection and caught partial failures preserved; prior36/37 shared changes retained. Existing exact isolated cumulative live log completed4/4 zero failures/skips/cancellations, so no duplicate test run. Diff check clean. Ledger5CRUD/0acquisitions,110remainingCRUD including structural adapter/53acquisitions/0CLI consistent. Mandatory hooks required.; live parity passed on identical production sources before this documentation-only update.

Slice37c committed `753a60ea83b888e33c998b01fa9363bdd8d0a3ac` ([diff](https://github.com/gennit-project/multiforum-backend/commit/753a60ea83b888e33c998b01fa9363bdd8d0a3ac)), tree `b8fa2459523918ec2fdd8af66d18099ae296d13b`: lint, TypeScript and all2433 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice37c-exact-live.log. Independent approval recorded above.

### Slice 38a — Bot parent thread reads

1 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 109 CRUD sites/17 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

45a campaign service and worker operations independently reviewed and queued:7CRUD;11focused,8live and static checks passed. Actual schema context and downstream partial-commit ordering preserved. No credit before integration.

38a final integration approval: Independent cumulative38a review against753a60ea83b888e33c998b01fa9363bdd8d0a3ac. All five executable/test blobs exactly match approved8fc2ebb2; original integration_recovery3focused/16trigger units/static evidence reused. Exact cumulative2live passed zero failures/skips/cancellations, covering actual author unions/special IDs/missing reads and cycle/depth/chronological thread ordering. commentTrigger only replaces parent-reader injection with configured-driver repository; remaining report/execution logic unchanged. Diff check clean. One structural call removed, zero typed calls/acquisitions: structural adjustment1to0 and total109runtime equals109typed,53acquisitions/0CLI. Queued45a evidence accurate without credit. Mandatory hooks required; future43 integration must retain38a parent-thread wiring.; live parity passed on identical production sources before this documentation-only update.

Slice38a committed `31e9cc74dca4749fc45b630703f52f6c5df27719` ([diff](https://github.com/gennit-project/multiforum-backend/commit/31e9cc74dca4749fc45b630703f52f6c5df27719)), tree `113341925bf1e38f21f60e2ec6d75c69ae762f2e`: lint, TypeScript and all2434 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice38a-exact-live.log. Independent approval recorded above.

### Slice 38b — Bot identities

7 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 102 CRUD sites/17 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

45b campaign history and failure queries independently reviewed and queued:3CRUD;4focused,5live and static checks passed. Actual schema context and destination error propagation preserved. No credit before integration.

38b final integration approval: Independent cumulative review against31e9cc74: nine nonshared executable/test blobs match prepared ec61b967 exactly; reused original independent19focused/author47focused/static evidence. Three adapted files preserve37c channel pipeline repository and required configured driver,38a parent-thread repository and all existing context ports; add only identity port forwarding/removal of unused model forwarding. Exact isolated15live passed zero failures/skips/cancellations. Identity creation/reactivation stale response, sequential profile reconciliation, missing-channel committed prefix and native event/default projection parity retained. Diff check clean. Ledger102 runtime CRUD/53acquisitions/zero structural/zeroCLI correct;45b queued without credit. Mandatory hooks remain parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice38b committed `09233b6ea062d4d74263461742580a4bfb70ba67` ([diff](https://github.com/gennit-project/multiforum-backend/commit/09233b6ea062d4d74263461742580a4bfb70ba67)), tree `c465241d418ded599ff05e5ed144d7c1f24ee361`: lint, TypeScript and all2438 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice38b-exact-live.log. Independent approval recorded above.

### Slice 38c — Bot comments

1 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 101 CRUD sites/16 files; 53 acquisitions/7 files; 0 separate CLI CRUD sites.

45c campaign creation and status controls independently reviewed and queued:4CRUD;3focused,7live and static checks passed. Actual schema context, native events and partial-commit failure contract preserved. No credit before integration.

38c final integration approval: Independent cumulative review against09233b6e. Five executable/test blobs identical to approvedfc30e825; original independent7focused,29authorfocused,16trigger and static evidence reused. Only adapted executable file removes unused Comment forwarding while retaining38a parent-thread and38b identity repository wiring. Exact isolated12live passed zero failures/skips/cancellations: full default response/connections/native events, pre-identity missing-parent rejection, committed projection failure and existing bot service contracts. SHA2567121dbab1bd887cb044bae14d6f0e50dca447a7aa435f3452db59ef1e5b59ade verified; diff check clean. Ledger101runtimeCRUD/53acquisitions and queued45c without credit consistent. Mandatory hooks parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice38c committed `50c32b5ce7e061506ef08d113db2803645c4944a` ([diff](https://github.com/gennit-project/multiforum-backend/commit/50c32b5ce7e061506ef08d113db2803645c4944a)), tree `ecdbd25f6c9c96d7879c842aea8afb035e766ba2`: lint, TypeScript and all2441 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice38c-exact-live.log. Independent approval recorded above.

### Slice 38d — Channel bot membership

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 97 CRUD sites/15 files; 50 acquisitions/6 files; 0 separate CLI CRUD sites.

46 seed endpoint independently reviewed and queued:9CRUD;4focused,12live and static checks passed. Original defaults, owner requirements, write/session order and failure contracts preserved. Cumulative integration must retain31 helper adaptations. No credit before integration.

38d final integration approval: Independent cumulative review against50c32b5c. Four executable/test blobs identical to approved0ff68c00; preserved ledger confirms review_bot38d independent13focused/3live/static approval, author19focused evidence reused. Context adaptation only adds channelBotRepository while retaining botIdentity and all prior ports. Exact isolated3live passed zero failures/skips/cancellations, including29unbounded server reads, middleware ordering and swallowed postcommit projection error preventing disconnect. Patch SHA256 b2f666bb45674fa18784ef5bf0d96b09e216a2233f02b342f8f10b3e3303d448 verified; diff check clean. Ledger97CRUD/50acquisitions/0CLI and queued46 corrected evidence without credit accurate. Mandatory hooks parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice38d committed `0c6a72eed73d185bf96c64b12f9d307c27f51030` ([diff](https://github.com/gennit-project/multiforum-backend/commit/0c6a72eed73d185bf96c64b12f9d307c27f51030)), tree `58d97948d1a2d82def96f3900622ccc9ad67d727`: lint, TypeScript and all2442 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice38d-exact-live.log. Independent approval recorded above.

### Slice 39 — Bot reports

6 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 91 CRUD sites/14 files; 50 acquisitions/6 files; 0 separate CLI CRUD sites.

Pipeline integration rehearsal: reviewed40a/40b/43 imports retain bot-thread/identity/comment/report wiring;46 retains31 discussion/event repository helpers. TypeScript and20focused checks passed. Every cumulative slice still requires exact live checks, independent review and mandatory hooks. The rehearsal's zero CRUD count is not completion credit: runtime wiring/acquisitions remain.

Known preserved contracts: channel/start/rerun singular DownloadableFile selections currently fail against the plural production schema. Per-file channel identity/retry/status and attachment-edit event scope require a separate explicit behavior decision; no first/all-file correction is included. Actual anonymous generated-schema URL context redacts file URLs, so campaign preview/worker tests preserve zero accessible files/dispatch. Clearly labelled trusted-URL test fixtures exercise downstream campaign ordering/partial writes only; they are not production context changes. Generated campaign updates still publish native events despite disabled subscription fields.

Runtime wiring remains in scope after CRUD integration: replace model acquisitions/capability guards with explicit domain dependencies, remove obsolete factory/background forwarding and application OGM initialization, and keep OGM baseline fixtures/codegen isolated from production runtime. Preserve mention raw-Cypher fallback, missing-capability early returns, raw-model versus protected Issue semantics, schema registration before internal operations, subscription context and test isolation. Type/codegen/package removal remains assessment-only at the checkpoint.

39 final integration approval: Independent cumulative review against0c6a72ee. All five executable/test blobs exactly match corrected approved raw-caller caba6738; SHA256476e45c8948a876b53ab359bb23311d5311e2fde8d6b5374c9b0937eed44fc3c verified. Baseline explicitly uses raw app.ogm.model(Issue), matching unchanged middleware; no protected proxy attachment/guard added. Prior38 thread/identity/comment/context wiring unchanged. Exact isolated21live passed zero failures/skips/cancellations, including production-schema attributed create durable prefix then generated-input rejection, raw native event/graph parity and nine existing standalone-schema services. Prior11focused/static evidence reused; diff check clean. Ledger91CRUD/14files/50acquisitions/0CLI and preparatory-only integration review accurate. Mandatory hooks parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice39 committed `739639d7b3097276309a6931c14041820e6c5369` ([diff](https://github.com/gennit-project/multiforum-backend/commit/739639d7b3097276309a6931c14041820e6c5369)), tree `047ca6bdb3001935eed39ac0f4e465b4a8899b7a`: lint, TypeScript and all2447 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice39-exact-live.log. Independent approval recorded above.

### Slice 40w — Configured pipeline driver forwarding

0 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 91 CRUD sites/14 files; 50 acquisitions/6 files; 0 separate CLI CRUD sites.

W1 capability wiring reviewed and queued:7acquisitions,0CRUD;42unique focused tests and19live cases plus TypeScript/lint passed. HTTP full capabilities and explicit background mention capability replace only legacy model-presence signals; missing capabilities and lowercased raw-driver mention fallback remain distinct. No removal credit before integration.

40w final integration approval: Independent cumulative40w review against739639d7. All eleven executable/test added/removed-line sequences match approved driver-foundation patch; inspected cumulative create/updateDiscussion context retaining31 named repositories and configured driver forwarding. Only dependency forwarding/type/test assertions, no operation/order changes. Exact isolated2live passed zero failures/skips/cancellations; prior46focused/static evidence reused. Diff check clean.91CRUD/50acquisitions unchanged;39 complete and W1 queued without credit accurate. Mandatory hooks parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice40w committed `8cf2470e8820e1fa6fe03c45fd8f34c70caf98b9` ([diff](https://github.com/gennit-project/multiforum-backend/commit/8cf2470e8820e1fa6fe03c45fd8f34c70caf98b9)), tree `f23c09aa4fc9a256a71e59e2694bde6186576a66`: lint, TypeScript and all2447 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice40w-exact-live.log. Independent approval recorded above.

### Slice 44a — Pipeline notifications

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 87 CRUD sites/13 files; 50 acquisitions/6 files; 0 separate CLI CRUD sites.

44a final integration approval: Independent cumulative44a against8cf2470e. All six executable/test blobs identical to approved157dc1ca; original27focused/static review reused. Four finite operations and configured driver callers preserve optionalUser early return, full User default selection, separate claim/write commits and no retry after committed projection failure. Exact isolated8live passed zero failures/skips/cancellations including raw IDs/endpoints, ordered native events and default selection assertion. Diff check clean; ledger87CRUD/50acquisitions/0CLI accurate. Mandatory hooks parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice44a committed `ca939ef5e2a86457d1d55ce5f5bdb1a0bd3e3268` ([diff](https://github.com/gennit-project/multiforum-backend/commit/ca939ef5e2a86457d1d55ce5f5bdb1a0bd3e3268)), tree `876be0a6f3ad5455657f122b476930a4fd99e20a`: lint, TypeScript and all2454 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice44a-exact-live.log. Independent approval recorded above.

### Slice 40a — Pipeline leases

6 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 81 CRUD sites/12 files; 50 acquisitions/6 files; 0 separate CLI CRUD sites.

40a final integration approval: Independent cumulative40a againstca939ef5. Ten executable/test blobs identical to approvedccfd09ee; sole commentTrigger adaptation matches reviewed integrated patch additions/removals and retains38 bot thread/identity/comment wiring. Configured driver and optional lease port forwarded through all three triggers including heartbeat/completion. Exact isolated8live passed zero failures/skips/cancellations. Original30focused plus overlapping6lease units/static reused. Separate job/parent writes, defaults, stale-owner sequential behavior and committed failure/retry contracts preserved; no concurrent atomicity claim. Diff check clean;81CRUD/50acquisitions/0CLI ledger accurate. Mandatory hooks parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice40a committed `5011245d7704258fd2a5ecb61ce156db585f98d9` ([diff](https://github.com/gennit-project/multiforum-backend/commit/5011245d7704258fd2a5ecb61ce156db585f98d9)), tree `d47a6c9db9344278a8f210b7568861dfc05dbcf9`: lint, TypeScript and all2455 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice40a-exact-live.log. Independent approval recorded above.

### Slice 40b — Pipeline attempts

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 77 CRUD sites/11 files; 50 acquisitions/6 files; 0 separate CLI CRUD sites.

40b final integration approval: Independent cumulative40b against5011245d. Twelve executable/test blobs identical to approved2cee7848; commentTrigger sole adaptation matches reviewed integrated patch changes and retains bot thread/lease wiring. Exact isolated12live passed zero failures/skips/cancellations. Original39focused/static reused; unbounded prior attempts, full defaults, QUEUED response before separate RUNNING write, completion clock/status and partial committed failure prefixes unchanged. Diff check clean;77CRUD/50acquisitions/0CLI ledger accurate. Mandatory hooks parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice40b committed `cf26228a72967c6f2288310f3a865edde3897bf3` ([diff](https://github.com/gennit-project/multiforum-backend/commit/cf26228a72967c6f2288310f3a865edde3897bf3)), tree `c062895cd6d0e58d72e10d73f3e401f855841527`: lint, TypeScript and all2455 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice40b-exact-live.log. Independent approval recorded above.

### Slice 40c — Pipeline watchdog

4 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 73 CRUD sites/10 files; 50 acquisitions/6 files; 0 separate CLI CRUD sites.

40c final integration approval: Independent cumulative40c againstcf26228a. All five executable/test blobs identical to approved54806af5; prior4focused/static evidence reused. Exact isolated7live passed zero failures/skips/cancellations, covering29unbounded active jobs, renewal-after-read guard, legacy deadline fallback, sibling/notification boundaries and committed projection failure prefixes. Job writes then unique parent/status/attempt/notification order and timers unchanged; raw native IDs/events retained. Diff check clean; ledger73CRUD/50acquisitions/0CLI accurate. Mandatory hooks parent-owned.; live parity passed on identical production sources before this documentation-only update.

Slice40c committed `717ac04a4862f76127342be91f746c3c966b3ee0` ([diff](https://github.com/gennit-project/multiforum-backend/commit/717ac04a4862f76127342be91f746c3c966b3ee0)), tree `1e3cd20d37999e29cfb832b374734d0f1e100c20`: lint, TypeScript and all2455 units passed; Disposable live parity passed on identical production sources before documentation-only review update; see /tmp/runtime-slice40c-exact-live.log. Independent approval recorded above.

### Slice 41 — Download execution

12 baseline CRUD sites removed. Original patch independently reviewed; see recorded slice evidence; cumulative integration review pending. Original focused/live/static gates passed; final cumulative checks pending. Parent cumulative gates pending. Remaining 61 CRUD sites/9 files; 50 acquisitions/6 files; 0 separate CLI CRUD sites.

41 final integration approval: Independent cumulative41 against717ac04a. All six executable/test blobs identical to approved19508443; prior21focused/static evidence reused. Exact isolated8live passed zero failures/skips/cancellations. Twelve calls replaced by seven finite ports with original inputs/selections/defaults and ordered lease/attempt/notification effects; primitive native graph/event parity plus actual fake-plugin trigger smoke preserved, not overstated as full service event parity. Diff check clean; ledger61CRUD/50acquisitions/0CLI accurate. Mandatory hooks parent-owned.; live parity passed on identical production sources before this documentation-only update.
