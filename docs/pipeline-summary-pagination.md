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
through `getPipelineRunPage`, regardless of the history window.

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
time is fixture-specific. Status EXISTS lookups are measured separately. Optional
filters may examine more index entries; job page sorting must examine the selected
attempt's fan-out (including legacy null execution orders), although returned jobs
are bounded. Do not describe all database work as constant or page-size-only.
