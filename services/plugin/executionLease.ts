import { randomUUID } from "node:crypto";
import type {
  PluginPipelineRunModel,
  PluginRunModel,
  PluginRunUpdateInput,
} from "../../ogm_types.js";
import { PluginRunStatus } from "../../ogm_types.js";
import { logger } from "../../logger.js";

const DEFAULT_LEASE_DURATION_MS = 5 * 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

const positiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const pluginJobLeaseDurationMs = () =>
  positiveNumber(process.env.PLUGIN_JOB_LEASE_MS, DEFAULT_LEASE_DURATION_MS);

export const pluginJobHeartbeatIntervalMs = () =>
  positiveNumber(
    process.env.PLUGIN_JOB_HEARTBEAT_MS,
    DEFAULT_HEARTBEAT_INTERVAL_MS
  );

const leaseDeadline = (now: Date, leaseDurationMs: number) =>
  new Date(now.getTime() + leaseDurationMs).toISOString();

export const createQueuedPluginRunTiming = ({
  now = new Date(),
  leaseDurationMs = pluginJobLeaseDurationMs(),
}: {
  now?: Date;
  leaseDurationMs?: number;
} = {}) => ({
  queuedAt: now.toISOString(),
  timeoutAt: leaseDeadline(now, leaseDurationMs),
});

export type PluginRunLease = {
  pluginRunId: string;
  pipelineId: string;
  leaseId: string;
};

export const claimPluginRunLease = async ({
  PluginRun,
  PluginPipelineRun,
  pluginRunId,
  pipelineId,
  now = new Date(),
  leaseDurationMs = pluginJobLeaseDurationMs(),
  leaseId = randomUUID(),
}: {
  PluginRun: PluginRunModel;
  PluginPipelineRun: PluginPipelineRunModel;
  pluginRunId: string;
  pipelineId: string;
  now?: Date;
  leaseDurationMs?: number;
  leaseId?: string;
}): Promise<PluginRunLease | null> => {
  const timestamp = now.toISOString();
  const timeoutAt = leaseDeadline(now, leaseDurationMs);
  const result = await PluginRun.update({
    where: { id: pluginRunId, status: PluginRunStatus.Pending },
    update: {
      status: PluginRunStatus.Running,
      leaseId,
      startedAt: timestamp,
      heartbeatAt: timestamp,
      timeoutAt,
    },
    selectionSet: `{ pluginRuns { id } }`,
  });
  if (result.pluginRuns.length === 0) return null;

  await PluginPipelineRun.update({
    where: { pipelineId },
    update: {
      heartbeatAt: timestamp,
      timeoutAt,
    },
  });
  return { pluginRunId, pipelineId, leaseId };
};

export const renewPluginRunLease = async ({
  PluginRun,
  PluginPipelineRun,
  lease,
  now = new Date(),
  leaseDurationMs = pluginJobLeaseDurationMs(),
}: {
  PluginRun: PluginRunModel;
  PluginPipelineRun: PluginPipelineRunModel;
  lease: PluginRunLease;
  now?: Date;
  leaseDurationMs?: number;
}) => {
  const timestamp = now.toISOString();
  const timeoutAt = leaseDeadline(now, leaseDurationMs);
  const result = await PluginRun.update({
    where: {
      id: lease.pluginRunId,
      leaseId: lease.leaseId,
      status: PluginRunStatus.Running,
    },
    update: { heartbeatAt: timestamp, timeoutAt },
    selectionSet: `{ pluginRuns { id } }`,
  });
  if (result.pluginRuns.length === 0) return false;

  await PluginRun.update({
    where: {
      pipelineId: lease.pipelineId,
      status: PluginRunStatus.Pending,
    },
    update: { timeoutAt },
  });
  await PluginPipelineRun.update({
    where: { pipelineId: lease.pipelineId },
    update: { heartbeatAt: timestamp, timeoutAt },
  });
  return true;
};

export const completePluginRunLease = async ({
  PluginRun,
  lease,
  update,
  now = new Date(),
}: {
  PluginRun: PluginRunModel;
  lease: PluginRunLease;
  update: PluginRunUpdateInput;
  now?: Date;
}) => {
  const timestamp = now.toISOString();
  return PluginRun.update({
    where: {
      id: lease.pluginRunId,
      leaseId: lease.leaseId,
      status: PluginRunStatus.Running,
    },
    update: {
      ...update,
      heartbeatAt: timestamp,
      finishedAt: timestamp,
      timeoutAt: null,
    },
  });
};

export const startPluginRunHeartbeat = ({
  PluginRun,
  PluginPipelineRun,
  lease,
  intervalMs = pluginJobHeartbeatIntervalMs(),
}: {
  PluginRun: PluginRunModel;
  PluginPipelineRun: PluginPipelineRunModel;
  lease: PluginRunLease;
  intervalMs?: number;
}) => {
  let stopped = false;
  let renewal: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (stopped || renewal) return;
    renewal = renewPluginRunLease({
      PluginRun,
      PluginPipelineRun,
      lease,
    })
      .then(() => undefined)
      .catch(error => {
        logger.error("Plugin job heartbeat failed", {
          pluginRunId: lease.pluginRunId,
          pipelineId: lease.pipelineId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        renewal = null;
      });
  }, intervalMs);
  timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
};
