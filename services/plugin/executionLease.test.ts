import {pipelineLeaseRepositoryStub} from "../../tests/fixtures/pipelineLeaseRepositoryStub.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap } from "../../ogm_types.js";
import {
  PluginRunStatus,
} from "../../ogm_types.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import {
  cancelSupersededPluginRuns,
  claimPluginRunLease as actualclaimPluginRunLease,
  completePluginRunLease as actualcompletePluginRunLease,
  createQueuedPluginRunTiming,
  renewPluginRunLease as actualrenewPluginRunLease,
  reschedulePluginRunLease as actualreschedulePluginRunLease,
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

test("cancels only older pending jobs for the same target and plugin", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const repository = {
    cancelOlderPendingJobs: async (where: unknown, update: unknown) => {
      calls.push({ where, update });
      return { pluginRuns: [{ id: "older-job" }] };
    },
  } as unknown as import("../persistence/pipelineLeaseRepository.js").PipelineLeaseRepository;

  const result = await cancelSupersededPluginRuns({
    repository,
    currentRun: {
      id: "current-job",
      pluginId: "moderator",
      pipelineId: "pipeline-2",
      scope: "CHANNEL",
      channelId: "cats",
      targetId: "discussion-1",
      targetType: "Discussion",
      queuedAt: "2026-07-30T12:01:00.000Z",
    },
    now: new Date("2026-07-30T12:01:01.000Z"),
  });

  assert.deepEqual(result.pluginRuns, [{ id: "older-job" }]);
  assert.deepEqual(calls, [{
    where: {
      pluginId: { eq: "moderator" },
      scope: { eq: "CHANNEL" },
      channelId: { eq: "cats" },
      targetId: { eq: "discussion-1" },
      targetType: { eq: "Discussion" },
      status: { eq: PluginRunStatus.Pending },
      queuedAt: { lt: "2026-07-30T12:01:00.000Z" },
      AND: [
        { NOT: { id: { eq: "current-job" } } },
        { NOT: { pipelineId: { eq: "pipeline-2" } } },
      ],
    },
    update: {
      status: PluginRunStatus.Cancelled,
      message: "Superseded by a newer content revision",
      skippedReason: "Superseded by a newer content revision",
      finishedAt: "2026-07-30T12:01:01.000Z",
      timeoutAt: null,
    },
  }]);
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
      status: { set: PluginRunStatus.Succeeded },
      message: { set: "Done" },
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
      status: { set: PluginRunStatus.Succeeded },
      message: { set: "Done" },
      heartbeatAt: "2026-07-30T12:02:00.000Z",
      finishedAt: "2026-07-30T12:02:00.000Z",
      timeoutAt: null,
    },
  });
});

test("retry scheduling returns only the leased running job to pending", async () => {
  const updates: RunUpdateArgs[] = [];
  const PluginRun = modelStub<"PluginRun">({
    update: async args => {
      updates.push(args);
      return { pluginRuns: [{ id: "job-1" }] };
    },
  });

  await reschedulePluginRunLease({
    PluginRun,
    lease: {
      pluginRunId: "job-1",
      pipelineId: "pipeline-1",
      leaseId: "lease-1",
    },
    update: {
      retryCount: 1,
      nextAttemptAt: "2026-07-30T12:00:30.000Z",
      message: "service unavailable (retry 1/3 scheduled)",
    },
  });

  assert.deepEqual(updates[0], {
    where: {
      id: "job-1",
      leaseId: "lease-1",
      status: PluginRunStatus.Running,
    },
    update: {
      retryCount: 1,
      nextAttemptAt: "2026-07-30T12:00:30.000Z",
      message: "service unavailable (retry 1/3 scheduled)",
      status: PluginRunStatus.Pending,
      leaseId: null,
      heartbeatAt: null,
      timeoutAt: null,
      finishedAt: null,
    },
  });
});

type LeaseModels = {
  PluginRun?: ModelMap['PluginRun']
  PluginPipelineRun?: ModelMap['PluginPipelineRun']
}

const claimPluginRunLease = (
  args: Parameters<typeof actualclaimPluginRunLease>[0] & LeaseModels
) => {
  const { PluginRun, PluginPipelineRun, ...rest } = args
  return actualclaimPluginRunLease({...rest,repository:pipelineLeaseRepositoryStub({PluginRun,PluginPipelineRun})})
}

const completePluginRunLease = (
  args: Parameters<typeof actualcompletePluginRunLease>[0] & LeaseModels
) => {
  const { PluginRun, PluginPipelineRun, ...rest } = args
  return actualcompletePluginRunLease({...rest,repository:pipelineLeaseRepositoryStub({PluginRun,PluginPipelineRun})})
}

const renewPluginRunLease = (
  args: Parameters<typeof actualrenewPluginRunLease>[0] & LeaseModels
) => {
  const { PluginRun, PluginPipelineRun, ...rest } = args
  return actualrenewPluginRunLease({...rest,repository:pipelineLeaseRepositoryStub({PluginRun,PluginPipelineRun})})
}

const reschedulePluginRunLease = (
  args: Parameters<typeof actualreschedulePluginRunLease>[0] & LeaseModels
) => {
  const { PluginRun, PluginPipelineRun, ...rest } = args
  return actualreschedulePluginRunLease({...rest,repository:pipelineLeaseRepositoryStub({PluginRun,PluginPipelineRun})})
}

test('heartbeat retains non-overlap, ordered renewal and stop boundary', async t => {
  const {startPluginRunHeartbeat} = await import('./executionLease.js');
  const calls:string[]=[];let tick:()=>void=()=>{};let release!:()=>void;
  const timer={unref:()=>{calls.push('unref');}};
  t.mock.method(globalThis,'setInterval',((callback:()=>void,interval:number)=>{assert.equal(interval,10);tick=callback;return timer;}) as any);
  t.mock.method(globalThis,'clearInterval',((value:unknown)=>{assert.equal(value,timer);calls.push('stop');}) as any);
  const repository={
    renewOwnedJob:async()=>{calls.push('renew');await new Promise<void>(resolve=>{release=resolve;});return {pluginRuns:[{id:'job'}]};},
    extendPendingJobs:async()=>{calls.push('siblings');return {pluginRuns:[]};},
    extendAttempt:async()=>{calls.push('attempt');return {pluginPipelineRuns:[]};},
  } as unknown as import('../persistence/pipelineLeaseRepository.js').PipelineLeaseRepository;
  const heartbeat=startPluginRunHeartbeat({repository,lease:{pluginRunId:'job',pipelineId:'pipeline',leaseId:'lease'},intervalMs:10});
  tick();tick();assert.deepEqual(calls,['unref','renew']);release();await new Promise<void>(resolve=>setImmediate(resolve));assert.deepEqual(calls,['unref','renew','siblings','attempt']);heartbeat.stop();tick();assert.deepEqual(calls,['unref','renew','siblings','attempt','stop']);
});
