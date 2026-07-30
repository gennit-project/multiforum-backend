import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap } from "../../ogm_types.js";
import {
  PluginPipelineRunStatus,
  PluginRunStatus,
} from "../../ogm_types.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import { recoverExpiredPluginJobs } from "./pipelineWatchdog.js";

type RunUpdateArgs = Parameters<ModelMap["PluginRun"]["update"]>[0];
type AttemptUpdateArgs =
  Parameters<ModelMap["PluginPipelineRun"]["update"]>[0];

test("times out an expired job and releases its parent attempt", async () => {
  const jobUpdates: RunUpdateArgs[] = [];
  const attemptUpdates: AttemptUpdateArgs[] = [];
  const PluginRun = modelStub<"PluginRun">({
    find: async ({ where } = {}) =>
      where?.pipelineId
        ? [{ status: PluginRunStatus.TimedOut }]
        : [{
            id: "job-1",
            pipelineId: "pipeline-1",
            status: PluginRunStatus.Running,
            timeoutAt: "2026-07-30T11:59:00.000Z",
          }],
    update: async args => {
      jobUpdates.push(args);
      return { pluginRuns: [{ id: "job-1" }] };
    },
  });
  const PluginPipelineRun = modelStub<"PluginPipelineRun">({
    find: async () => [{
      pipelineId: "pipeline-1",
      status: PluginPipelineRunStatus.Running,
    }],
    update: async args => {
      attemptUpdates.push(args);
      return {};
    },
  });

  const result = await recoverExpiredPluginJobs({
    PluginRun,
    PluginPipelineRun,
    now: new Date("2026-07-30T12:00:00.000Z"),
  });

  assert.deepEqual(
    {
      result,
      jobStatus: jobUpdates[0]?.update?.status,
      jobFinishedAt: jobUpdates[0]?.update?.finishedAt,
      attemptStatus: attemptUpdates[0]?.update?.status,
      attemptFinishedAt: attemptUpdates[0]?.update?.finishedAt,
    },
    {
      result: { jobsTimedOut: 1, attemptsTimedOut: 1 },
      jobStatus: PluginRunStatus.TimedOut,
      jobFinishedAt: "2026-07-30T12:00:00.000Z",
      attemptStatus: PluginPipelineRunStatus.TimedOut,
      attemptFinishedAt: "2026-07-30T12:00:00.000Z",
    }
  );
});

test("leaves a renewed lease active", async () => {
  const updates: RunUpdateArgs[] = [];
  const PluginRun = modelStub<"PluginRun">({
    find: async () => [{
      id: "job-1",
      pipelineId: "pipeline-1",
      status: PluginRunStatus.Running,
      timeoutAt: "2026-07-30T12:01:00.000Z",
    }],
    update: async args => {
      updates.push(args);
      return {};
    },
  });

  const result = await recoverExpiredPluginJobs({
    PluginRun,
    PluginPipelineRun: modelStub<"PluginPipelineRun">(),
    now: new Date("2026-07-30T12:00:00.000Z"),
  });

  assert.deepEqual(
    { result, updates },
    {
      result: { jobsTimedOut: 0, attemptsTimedOut: 0 },
      updates: [],
    }
  );
});

test("recovers an active legacy job that predates lease deadlines", async () => {
  const updates: RunUpdateArgs[] = [];
  const PluginRun = modelStub<"PluginRun">({
    find: async ({ where } = {}) =>
      where?.pipelineId
        ? [{ status: PluginRunStatus.TimedOut }]
        : [{
            id: "legacy-job",
            pipelineId: "legacy-pipeline",
            status: PluginRunStatus.Pending,
            timeoutAt: null,
            createdAt: "2026-07-30T11:00:00.000Z",
          }],
    update: async args => {
      updates.push(args);
      return { pluginRuns: [{ id: "legacy-job" }] };
    },
  });

  const result = await recoverExpiredPluginJobs({
    PluginRun,
    PluginPipelineRun: modelStub<"PluginPipelineRun">({
      find: async () => [{
        pipelineId: "legacy-pipeline",
        status: PluginPipelineRunStatus.Queued,
      }],
      update: async () => ({}),
    }),
    now: new Date("2026-07-30T12:00:00.000Z"),
    leaseDurationMs: 60_000,
  });

  assert.equal(result.jobsTimedOut, 1);
  assert.deepEqual(updates[0]?.where, {
    id: "legacy-job",
    status_IN: [PluginRunStatus.Pending, PluginRunStatus.Running],
    timeoutAt: null,
  });
});

test("does not time out a lease that was renewed during recovery", async () => {
  let parentFindCount = 0;
  const result = await recoverExpiredPluginJobs({
    PluginRun: modelStub<"PluginRun">({
      find: async () => [{
        id: "job-1",
        pipelineId: "pipeline-1",
        status: PluginRunStatus.Running,
        timeoutAt: "2026-07-30T11:59:00.000Z",
      }],
      update: async () => ({ pluginRuns: [] }),
    }),
    PluginPipelineRun: modelStub<"PluginPipelineRun">({
      find: async () => {
        parentFindCount += 1;
        return [];
      },
    }),
    now: new Date("2026-07-30T12:00:00.000Z"),
  });

  assert.deepEqual(result, { jobsTimedOut: 0, attemptsTimedOut: 0 });
  assert.equal(parentFindCount, 0);
});
