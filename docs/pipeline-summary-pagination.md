# Bounded public pipeline history

Issue #359 adds two queries. Existing `getPipelineSummary`, `getPublicPipelineRun`,
raw/internal history APIs and execution/retry behavior are unchanged during migration.
Deploy the backend first, then migrate frontend consumers. Legacy polling remains
unbounded until those consumers switch; removal requires a separate compatibility decision.

```graphql
getPipelineSummaryPage(
  targetId: ID!, targetType: String!, first: Int = 10, after: String,
  jobsFirst: Int = 20, eventType: String, scope: String, channelId: String
): PluginPipelineSummaryPage!
getPipelineRunPage(
  pipelineRunId: ID!, first: Int = 20, after: String
): PublicPluginPipelineRunPage
```

Summary results contain `targetId`, `targetType`, `hasActiveWork`, `hasFailedWork`,
`pageInfo`, and `attempts`. Each attempt entry (also the detail result) contains:

- `run: PublicPluginPipelineRun!`: existing public metadata, with bounded `jobs`.
- `displayStatus: PluginRunStatus!`: computed from attempt and **all** matching jobs.
- `hasActiveWork: Boolean!`: pending/running work in that attempt, including omitted jobs.
- `jobsPageInfo`: `{hasNextPage: Boolean!, endCursor: String}`.

Summary `pageInfo` has the same shape. Limits are 1–50 attempts and 1–100 jobs per
attempt; out-of-range inputs fail rather than silently clamp. Null limits use defaults.
At most `first * jobsFirst` public jobs are returned. An extra row per page detects
continuation; jobs are fetched only for selected attempts, in one batched query,
and grouped by attempt once. Public projections and diagnostics redaction remain
shared with the existing API. Target visibility is checked before history/job reads;
detail first looks up the attempt to identify its target, like the existing detail API.

Filters apply before pagination and to the target-wide indicators. `scope` is
SERVER or CHANNEL; omitted/null filters mean all values. `channelId` is an exact
channel identifier (not a display name). Job membership also matches target, type,
event, scope and channel to prevent cross-target contamination by a pipeline ID.
For the latest attempt relevant to retry eligibility, query the exact event/scope/
channel with `first: 1`. Fetch an older attempt permalink directly by its run ID
through `getPipelineRunPage`, regardless of the history window. The argument accepts
an exact attempt ID first, then falls back to a legacy `pipelineId` for old
`?attempt={pipelineId}#attempt-{pipelineId}` bookmarks. The fallback reads at most
two matches and rejects ambiguity without choosing a target. Visibility is checked
on the resolved attempt; job cursors bind to its canonical ID, so continuation
works with either identifier form.

Status precedence is RUNNING, PENDING (including QUEUED attempts), FAILED,
TIMED_OUT, CANCELLED, then SKIPPED if the complete nonempty job set is skipped,
otherwise SUCCEEDED. This is conservative when attempt/job states disagree.
`run.status` remains the original attempt lifecycle status. Use `displayStatus`
for display and `hasActiveWork` for polling, never infer either from a partial list.
Target `hasActiveWork` checks all matching attempts and jobs, including older or
orphan jobs. `hasFailedWork` means **any historical** failed/timed-out attempt or
job; it is not the status of the latest retry. Cancellation is not counted as failure.

Attempts sort by `(createdAt DESC, id DESC)`. Jobs sort by
`(coalesce(executionOrder, 0) ASC, createdAt DESC, id DESC)`. Opaque versioned cursors
are bound to target/filter or attempt and retain database timestamp precision.
They are not authentication tokens: visibility is always rechecked. Page size can
change between requests. Newer inserts do not shift subsequent pages or duplicate
unchanged rows; inserts behind the cursor can appear later. These are live keyset
pages, not snapshot isolation. Ordering fields should remain immutable. Refresh
replaces the first page; frontend pagination should deduplicate IDs and avoid
combining cursors across changed filters/targets.

New indexes are installed during backend startup. `perf:pipeline-summary` uses a
disposable Neo4j container, the actual legacy/new resolvers for elapsed time,
response bytes and post-call heap growth, plus warm PROFILE plans for the new
reads and equivalent unbounded reads. Heap growth is not peak memory and elapsed
time is fixture-specific. Target-status EXISTS lookups are measured separately. Per-attempt statuses are
aggregated in one indexed pass over that selected attempt, returning at most seven
distinct enum values. Optional
filters may examine more index entries; job page sorting must examine the selected
attempt's fan-out (including legacy null execution orders), although returned jobs
are bounded. Do not describe all database work as constant or page-size-only.

## Disposable fixture results (2026-10-30)

Node 26.5.1, Neo4j Community 5.26.32 in local Docker. Five warm resolver calls per
case; medians below. Both paths used the same fixture and indexes; the baseline
is the unchanged legacy resolver. Limits: 10 attempts and 20 jobs per attempt.
These are development-container measurements, not production latency estimates.
Other checks ran concurrently, so timings and heap growth are noisy. Heap growth
is sampled after each call with GC before the call; it is not peak memory.

| Retained attempts × jobs each | Legacy → bounded median ms | Legacy → bounded response bytes | Legacy → bounded heap growth MiB |
| --- | ---: | ---: | ---: |
| 100 × 20 | 317.34 → 179.69 | 1,023,936 → 103,412 | 27.32 → 12.49 |
| 2,000 × 20 | 13,282.21 → 126.11 | 20,548,537 → 103,904 | 108.65 → 11.79 |
| 1 × 10,000 | 360.98 → 198.33 | 4,878,408 → 10,632 | 43.47 → 2.32 |

For both 100 and 2,000 attempts, the new first-page PROFILE used 221 db hits and
11 intermediate rows; a deep cursor read used 224 and 11. The unfiltered status
read used 8 hits and one row in these all-success fixtures. The selected-job read
used 6,020 hits and 200 intermediate rows in both cases. Equivalent unbounded
attempt/job reads at 2,000 attempts used 40,001/760,001 hits and 2,000/40,000 rows.
The equivalent unbounded PROFILE reads are not the library's exact generated
Cypher; elapsed/heap/response measurements do execute the actual legacy resolver.

The 10,000-job attempt returns only 20 jobs, but its job query still visits 10,000
rows (160,296 hits). An additional adversarial probe with 2,000 RUNNING SERVER
attempts and a CHANNEL filter matching none used 4,001 hits for attempt selection
and 4,008 for flags, each visiting 2,000 rows. Thus this change bounds returned
history and removes unrelated-history job loading; it does **not** promise fixed
work for arbitrary filtering or selected-attempt fan-out. Filter-specific indexes
or an indexed normalized job-order key would require separate measured work.

CI runs the reproducible profiler alongside `perf:cypher`. First/deep attempt-page
and unfiltered indicator budgets are independent of retained history. The regular
20-jobs-per-attempt cases also budget selected-job work at 40 hits per requested job
plus a fixed 1,000-hit allowance (measured 6,020 hits for 200 requested jobs), covering
public projection and the full-status pass while detecting
a regression to loading every historical job. The fan-out stress case enforces
returned-job bounds and reports its larger database cost separately. CI uploads
its raw JSON measurements in the existing performance-report artifact.
