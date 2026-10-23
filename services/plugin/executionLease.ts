import { PluginRunStatus } from "../../ogm_types.js";
import type { Driver } from "neo4j-driver";
import {
  createPipelineLeaseRepository,
  type PipelineLeaseRepository,
  type PluginEventClaimLimits,
} from "../persistence/pipelineLeaseRepository.js";
import { randomUUID } from "node:crypto";
import type {
  PluginRunUpdateInput,
} from "../../ogm_types.js";
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

export const cancelSupersededPluginRuns = async ({
  driver,
  repository,
  currentRun,
  now = new Date(),
}: {
  driver?: Driver;
  repository?: PipelineLeaseRepository;
  currentRun: {
    id: string;
    pluginId: string;
    pipelineId: string;
    scope: string;
    channelId: string | null;
    targetId: string;
    targetType: string;
    queuedAt: string;
  };
  now?: Date;
}) => {
  const persistence = repository ?? createPipelineLeaseRepository(driver!);
  const timestamp = now.toISOString();
  return persistence.cancelOlderPendingJobs(
    {
      id_NOT: currentRun.id,
      pluginId: currentRun.pluginId,
      pipelineId_NOT: currentRun.pipelineId,
      scope: currentRun.scope,
      channelId: currentRun.channelId,
      targetId: currentRun.targetId,
      targetType: currentRun.targetType,
      status: PluginRunStatus.Pending,
      queuedAt_LT: currentRun.queuedAt,
    },
    {
      status: PluginRunStatus.Cancelled,
      message: "Superseded by a newer content revision",
      skippedReason: "Superseded by a newer content revision",
      finishedAt: timestamp,
      timeoutAt: null,
    }
  );
};

export const claimPluginRunLease = async ({
  driver,
  repository,
  pluginRunId,
  pipelineId,
  now = new Date(),
  leaseDurationMs = pluginJobLeaseDurationMs(),
  leaseId = randomUUID(),
  claimLimits,
}: {
  driver?: Driver;
  repository?: PipelineLeaseRepository;
  pluginRunId: string;
  pipelineId: string;
  now?: Date;
  leaseDurationMs?: number;
  leaseId?: string;
  claimLimits?: PluginEventClaimLimits;
}): Promise<PluginRunLease | null> => {
  const timestamp = now.toISOString();
  const timeoutAt = leaseDeadline(now, leaseDurationMs);
  const persistence = repository ?? createPipelineLeaseRepository(driver!);
  const update = {
      status: PluginRunStatus.Running,
      leaseId,
      startedAt: timestamp,
      heartbeatAt: timestamp,
      timeoutAt,
  };
  const result = claimLimits && persistence.claimPendingEventJob
    ? await persistence.claimPendingEventJob(pluginRunId, update, claimLimits)
    : await persistence.claimPendingJob(pluginRunId, update);
  if (result.pluginRuns.length === 0) return null;

  await persistence.extendAttempt(pipelineId, {
      heartbeatAt: timestamp,
      timeoutAt,
  });
  return { pluginRunId, pipelineId, leaseId };
};

export const renewPluginRunLease = async ({
  driver,
  repository,
  lease,
  now = new Date(),
  leaseDurationMs = pluginJobLeaseDurationMs(),
}: {
  driver?: Driver;
  repository?: PipelineLeaseRepository;
  lease: PluginRunLease;
  now?: Date;
  leaseDurationMs?: number;
}) => {
  const timestamp = now.toISOString();
  const timeoutAt = leaseDeadline(now, leaseDurationMs);
  const persistence = repository ?? createPipelineLeaseRepository(driver!);
  const result = await persistence.renewOwnedJob(lease, { heartbeatAt: timestamp, timeoutAt });
  if (result.pluginRuns.length === 0) return false;

  await persistence.extendPendingJobs(lease.pipelineId, timeoutAt);
  await persistence.extendAttempt(lease.pipelineId, { heartbeatAt: timestamp, timeoutAt });
  return true;
};

export const completePluginRunLease = async ({
  driver,
  repository,
  lease,
  update,
  now = new Date(),
}: {
  driver?: Driver;
  repository?: PipelineLeaseRepository;
  lease: PluginRunLease;
  update: PluginRunUpdateInput;
  now?: Date;
}) => {
  const timestamp = now.toISOString();
  const persistence = repository ?? createPipelineLeaseRepository(driver!);
  return persistence.completeOwnedJob(lease, {
      ...update,
      heartbeatAt: timestamp,
      finishedAt: timestamp,
      timeoutAt: null,
  });
};

export const startPluginRunHeartbeat = ({
  driver,
  repository,
  lease,
  intervalMs = pluginJobHeartbeatIntervalMs(),
}: {
  driver?: Driver;
  repository?: PipelineLeaseRepository;
  lease: PluginRunLease;
  intervalMs?: number;
}) => {
  let stopped = false;
  let renewal: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (stopped || renewal) return;
    renewal = renewPluginRunLease({
      driver,
      repository,
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
