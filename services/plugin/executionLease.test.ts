import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap } from "../../ogm_types.js";
import {
  PluginRunStatus,
} from "../../ogm_types.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import {
  claimPluginRunLease,
  completePluginRunLease,
  createQueuedPluginRunTiming,
  renewPluginRunLease,
} from "./executionLease.js";

type RunUpdateArgs = Parameters<ModelMap["PluginRun"]["update"]>[0];
type AttemptUpdateArgs =
  Parameters<ModelMap["PluginPipelineRun"]["update"]>[0];

test("creates a deterministic queue deadline", () => {
  assert.deepEqual(
    createQueuedPluginRunTiming({
      now: new Date("2026-07-30T12:00:00.000Z"),
      leaseDurationMs: 60_000,
    }),
    {
      queuedAt: "2026-07-30T12:00:00.000Z",
      timeoutAt: "2026-07-30T12:01:00.000Z",
    }
  );
});

test("claims and renews a lease on both job and parent attempt", async () => {
  const jobUpdates: RunUpdateArgs[] = [];
  const attemptUpdates: AttemptUpdateArgs[] = [];
  const PluginRun = modelStub<"PluginRun">({
    update: async args => {
      jobUpdates.push(args);
      return { pluginRuns: [{ id: "job-1" }] };
    },
  });
  const PluginPipelineRun = modelStub<"PluginPipelineRun">({
    update: async args => {
      attemptUpdates.push(args);
      return {};
    },
  });

  const lease = await claimPluginRunLease({
    PluginRun,
    PluginPipelineRun,
    pluginRunId: "job-1",
    pipelineId: "pipeline-1",
    leaseId: "lease-1",
    now: new Date("2026-07-30T12:00:00.000Z"),
    leaseDurationMs: 60_000,
  });
  assert.ok(lease);
  await renewPluginRunLease({
    PluginRun,
    PluginPipelineRun,
    lease,
    now: new Date("2026-07-30T12:00:30.000Z"),
    leaseDurationMs: 60_000,
  });

  assert.deepEqual(
    {
      lease,
      claim: jobUpdates[0],
      renewal: jobUpdates[1],
      pendingSiblingRenewal: jobUpdates[2],
      parentRenewal: attemptUpdates[1],
    },
    {
      lease: {
        pluginRunId: "job-1",
        pipelineId: "pipeline-1",
        leaseId: "lease-1",
      },
      claim: {
        where: { id: "job-1", status: PluginRunStatus.Pending },
        update: {
          status: PluginRunStatus.Running,
          leaseId: "lease-1",
          startedAt: "2026-07-30T12:00:00.000Z",
          heartbeatAt: "2026-07-30T12:00:00.000Z",
          timeoutAt: "2026-07-30T12:01:00.000Z",
        },
        selectionSet: `{ pluginRuns { id } }`,
      },
      renewal: {
        where: {
          id: "job-1",
          leaseId: "lease-1",
          status: PluginRunStatus.Running,
        },
        update: {
          heartbeatAt: "2026-07-30T12:00:30.000Z",
          timeoutAt: "2026-07-30T12:01:30.000Z",
        },
        selectionSet: `{ pluginRuns { id } }`,
      },
      pendingSiblingRenewal: {
        where: {
          pipelineId: "pipeline-1",
          status: PluginRunStatus.Pending,
        },
        update: {
          timeoutAt: "2026-07-30T12:01:30.000Z",
        },
      },
      parentRenewal: {
        where: { pipelineId: "pipeline-1" },
        update: {
          heartbeatAt: "2026-07-30T12:00:30.000Z",
          timeoutAt: "2026-07-30T12:01:30.000Z",
        },
      },
    }
  );
});

test("a stale heartbeat cannot renew the parent or queued siblings", async () => {
  const jobUpdates: RunUpdateArgs[] = [];
  const parentUpdates: AttemptUpdateArgs[] = [];
  const renewed = await renewPluginRunLease({
    PluginRun: modelStub<"PluginRun">({
      update: async args => {
        jobUpdates.push(args);
        return { pluginRuns: [] };
      },
    }),
    PluginPipelineRun: modelStub<"PluginPipelineRun">({
      update: async args => {
        parentUpdates.push(args);
        return {};
      },
    }),
    lease: {
      pluginRunId: "job-1",
      pipelineId: "pipeline-1",
      leaseId: "stale-lease",
    },
  });

  assert.equal(renewed, false);
  assert.equal(jobUpdates.length, 1);
  assert.equal(parentUpdates.length, 0);
});

test("does not grant a lease when another worker already claimed the job", async () => {
  const parentUpdates: AttemptUpdateArgs[] = [];
  const lease = await claimPluginRunLease({
    PluginRun: modelStub<"PluginRun">({
      update: async () => ({ pluginRuns: [] }),
    }),
    PluginPipelineRun: modelStub<"PluginPipelineRun">({
      update: async args => {
        parentUpdates.push(args);
        return {};
      },
    }),
    pluginRunId: "job-1",
    pipelineId: "pipeline-1",
    leaseId: "losing-lease",
  });

  assert.equal(lease, null);
  assert.equal(parentUpdates.length, 0);
});

test("terminal writes require the current running lease", async () => {
  const updates: RunUpdateArgs[] = [];
  const PluginRun = modelStub<"PluginRun">({
    update: async args => {
      updates.push(args);
      return {};
    },
  });

  await completePluginRunLease({
    PluginRun,
    lease: {
      pluginRunId: "job-1",
      pipelineId: "pipeline-1",
      leaseId: "lease-1",
    },
    update: {
      status: PluginRunStatus.Succeeded,
      message: "Done",
    },
    now: new Date("2026-07-30T12:02:00.000Z"),
  });

  assert.deepEqual(updates[0], {
    where: {
      id: "job-1",
      leaseId: "lease-1",
      status: PluginRunStatus.Running,
    },
    update: {
      status: PluginRunStatus.Succeeded,
      message: "Done",
      heartbeatAt: "2026-07-30T12:02:00.000Z",
      finishedAt: "2026-07-30T12:02:00.000Z",
      timeoutAt: null,
    },
  });
});
