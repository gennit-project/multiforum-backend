import type {
  PluginPipelineRun,
  PluginPipelineRunModel,
  PluginRun,
  PluginRunModel,
} from "../../ogm_types.js";
import {
  PluginPipelineRunStatus,
  PluginRunStatus,
} from "../../ogm_types.js";
import { logger } from "../../logger.js";
import {
  completePipelineAttempt,
  type PipelineJobStatus,
} from "./pipelineAttempt.js";
import { pluginJobLeaseDurationMs } from "./executionLease.js";

const DEFAULT_WATCHDOG_INTERVAL_MS = 60_000;
const ACTIVE_JOB_STATUSES: string[] = [
  PluginRunStatus.Pending,
  PluginRunStatus.Running,
];
const PIPELINE_JOB_STATUSES = new Set<PipelineJobStatus>([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "TIMED_OUT",
  "CANCELLED",
]);

type ExpirableJob = Pick<
  PluginRun,
  | "id"
  | "pipelineId"
  | "status"
  | "queuedAt"
  | "startedAt"
  | "heartbeatAt"
  | "timeoutAt"
  | "createdAt"
>;
type ActiveAttempt = Pick<
  PluginPipelineRun,
  "pipelineId" | "status"
>;

const positiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const pluginPipelineWatchdogIntervalMs = () =>
  positiveNumber(
    process.env.PLUGIN_PIPELINE_WATCHDOG_MS,
    DEFAULT_WATCHDOG_INTERVAL_MS
  );

const asPipelineJobStatus = (status: string): PipelineJobStatus =>
  PIPELINE_JOB_STATUSES.has(status as PipelineJobStatus)
    ? (status as PipelineJobStatus)
    : "FAILED";

export const recoverExpiredPluginJobs = async ({
  PluginRun,
  PluginPipelineRun,
  now = new Date(),
  leaseDurationMs = pluginJobLeaseDurationMs(),
}: {
  PluginRun: PluginRunModel;
  PluginPipelineRun: PluginPipelineRunModel;
  now?: Date;
  leaseDurationMs?: number;
}) => {
  const timestamp = now.toISOString();
  const candidates = (await PluginRun.find({
    where: {
      status_IN: ACTIVE_JOB_STATUSES,
    },
    selectionSet: `{
      id pipelineId status queuedAt startedAt heartbeatAt timeoutAt createdAt
    }`,
  })) as ExpirableJob[];
  const expired = candidates.filter(
    job => {
      const explicitDeadline = job.timeoutAt
        ? Date.parse(String(job.timeoutAt))
        : Number.NaN;
      const legacyActivity = Date.parse(
        String(
          job.heartbeatAt ||
            job.startedAt ||
            job.queuedAt ||
            job.createdAt
        )
      );
      const deadline = Number.isFinite(explicitDeadline)
        ? explicitDeadline
        : legacyActivity + leaseDurationMs;
      return (
        Number.isFinite(deadline) &&
        deadline <= now.getTime() &&
        ACTIVE_JOB_STATUSES.includes(job.status)
      );
    }
  );

  const pipelineIds = new Set<string>();
  let jobsTimedOut = 0;
  for (const job of expired) {
    const result = await PluginRun.update({
      where: {
        id: job.id,
        status_IN: ACTIVE_JOB_STATUSES,
        ...(job.timeoutAt
          ? { timeoutAt_LTE: timestamp }
          : { timeoutAt: null }),
      },
      update: {
        status: PluginRunStatus.TimedOut,
        message: "Plugin execution lease expired",
        heartbeatAt: timestamp,
        finishedAt: timestamp,
        timeoutAt: null,
      },
      selectionSet: `{ pluginRuns { id } }`,
    });
    if (result.pluginRuns.length === 0) continue;
    jobsTimedOut += 1;
    if (job.pipelineId) pipelineIds.add(job.pipelineId);
  }

  let attemptsTimedOut = 0;
  for (const pipelineId of pipelineIds) {
    const attempts = (await PluginPipelineRun.find({
      where: {
        pipelineId,
        status_IN: [
          PluginPipelineRunStatus.Queued,
          PluginPipelineRunStatus.Running,
        ],
      },
      selectionSet: `{ pipelineId status }`,
    })) as ActiveAttempt[];
    if (!attempts[0]) continue;

    const jobs = await PluginRun.find({
      where: { pipelineId },
      selectionSet: `{ status }`,
    });
    const status = await completePipelineAttempt({
      PluginPipelineRun,
      pipelineId,
      statuses: jobs.map(job => asPipelineJobStatus(job.status)),
      now: () => timestamp,
    });
    if (status === PluginPipelineRunStatus.TimedOut) {
      attemptsTimedOut += 1;
    }
  }

  return {
    jobsTimedOut,
    attemptsTimedOut,
  };
};

export class PluginPipelineWatchdogService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly models: {
      PluginRun: PluginRunModel;
      PluginPipelineRun: PluginPipelineRunModel;
    },
    private readonly intervalMs = pluginPipelineWatchdogIntervalMs()
  ) {}

  async runOnce() {
    if (this.running) return { jobsTimedOut: 0, attemptsTimedOut: 0 };
    this.running = true;
    try {
      const result = await recoverExpiredPluginJobs(this.models);
      if (result.jobsTimedOut > 0) {
        logger.warn("Recovered expired plugin execution leases", result);
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  async start() {
    await this.runOnce();
    this.timer = setInterval(() => {
      this.runOnce().catch(error => {
        logger.error("Plugin pipeline watchdog failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
