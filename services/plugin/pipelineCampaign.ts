import type {
  DownloadableFile,
  DownloadableFileModel,
  PluginPipelineCampaign,
  PluginPipelineCampaignModel,
  PluginPipelineRun,
  PluginPipelineRunModel,
  ServerConfigModel,
} from "../../ogm_types.js";
import {
  PluginPipelineCampaignStatus,
  PluginPipelineRunStatus,
  PluginPipelineRunTrigger,
} from "../../ogm_types.js";
import type { EventPipeline, Models } from "./types.js";
import { triggerPluginRunsForDownloadableFile } from "./downloadTrigger.js";
import { parseStoredPipelines } from "./pipelineUtils.js";
import { logger } from "../../logger.js";

export const DOWNLOAD_CREATED_EVENT = "downloadableFile.created";

type CampaignFile = Pick<
  DownloadableFile,
  "id" | "url" | "uploadedAt" | "createdAt" | "permanentlyRemoved"
>;

type CampaignAttempt = Pick<
  PluginPipelineRun,
  "targetId" | "status" | "createdAt"
>;

export type CampaignModels = Models & {
  DownloadableFile: DownloadableFileModel;
  PluginPipelineCampaign: PluginPipelineCampaignModel;
  PluginPipelineRun: PluginPipelineRunModel;
  ServerConfig: ServerConfigModel;
};

const isBefore = (file: CampaignFile, effectiveAt: string) => {
  const timestamp = Date.parse(String(file.uploadedAt || file.createdAt || ""));
  return Number.isFinite(timestamp) && timestamp < Date.parse(effectiveAt);
};

const isAccessible = (file: CampaignFile) =>
  Boolean(file.url) && file.permanentlyRemoved !== true;

export const enforcementBehaviorFor = (
  applicability: EventPipeline["applicability"]
) =>
  applicability === "ALL_FILES_IMMEDIATE"
    ? "Existing downloads are held until their required checks pass."
    : "New downloads are enforced immediately; existing downloads are checked gradually.";

export const getCampaignPolicy = async ({
  ServerConfig,
  policyId,
}: {
  ServerConfig: ServerConfigModel;
  policyId: string;
}) => {
  const configs = await ServerConfig.find({
    selectionSet: `{ pluginPipelines }`,
  });
  const pipelines = parseStoredPipelines(configs[0]?.pluginPipelines);
  const policy = pipelines.find(item => item.policyId === policyId);
  if (
    !policy ||
    !policy.event.startsWith("downloadableFile.") ||
    !policy.effectiveAt ||
    policy.applicability === "NEW_FILES_ONLY"
  ) {
    throw new Error("The rollout policy is not eligible for an existing-file campaign");
  }
  return policy;
};

export const previewPipelineCampaign = async ({
  DownloadableFile,
  ServerConfig,
  policyId,
}: Pick<CampaignModels, "DownloadableFile" | "ServerConfig"> & {
  policyId: string;
}) => {
  const policy = await getCampaignPolicy({ ServerConfig, policyId });
  const files = (await DownloadableFile.find({
    selectionSet: `{ id url uploadedAt createdAt permanentlyRemoved }`,
  })) as CampaignFile[];
  const affected = files.filter(file => isBefore(file, policy.effectiveAt!));
  const accessibleFileCount = affected.filter(isAccessible).length;

  return {
    policyId,
    eventType: policy.event,
    applicability: policy.applicability!,
    enforcementBehavior: enforcementBehaviorFor(policy.applicability),
    affectedFileCount: affected.length,
    accessibleFileCount,
    unavailableFileCount: affected.length - accessibleFileCount,
    estimatedProviderRuns: accessibleFileCount * policy.steps.length,
  };
};

export const campaignCounts = (attempts: CampaignAttempt[]) => ({
  completedCount: attempts.filter(
    item => item.status === PluginPipelineRunStatus.Succeeded
  ).length,
  runningCount: attempts.filter(item =>
    [PluginPipelineRunStatus.Queued, PluginPipelineRunStatus.Running].includes(
      item.status as PluginPipelineRunStatus
    )
  ).length,
  failedCount: attempts.filter(
    item =>
      item.status === PluginPipelineRunStatus.Failed ||
      item.status === PluginPipelineRunStatus.Cancelled
  ).length,
  timedOutCount: attempts.filter(
    item => item.status === PluginPipelineRunStatus.TimedOut
  ).length,
});

export const runPipelineCampaign = async ({
  models,
  campaign,
  now = new Date(),
  trigger = triggerPluginRunsForDownloadableFile,
}: {
  models: CampaignModels;
  campaign: PluginPipelineCampaign;
  now?: Date;
  trigger?: typeof triggerPluginRunsForDownloadableFile;
}) => {
  const policy = await getCampaignPolicy({
    ServerConfig: models.ServerConfig,
    policyId: campaign.policyId,
  });
  const attempts = (await models.PluginPipelineRun.find({
    where: { campaignId: campaign.id },
    selectionSet: `{ targetId status createdAt }`,
  })) as CampaignAttempt[];
  const counts = campaignCounts(attempts);
  const recentAttempts = attempts.filter(
    item => Date.parse(String(item.createdAt)) >= now.getTime() - 60_000
  ).length;
  const capacity = Math.max(0, campaign.concurrency - counts.runningCount);
  const rateCapacity = Math.max(
    0,
    campaign.rateLimitPerMinute - recentAttempts
  );
  const attemptedIds = new Set(attempts.map(item => item.targetId));
  const files = (await models.DownloadableFile.find({
    selectionSet: `{ id url uploadedAt createdAt permanentlyRemoved }`,
  })) as CampaignFile[];
  const candidates = files.filter(
    file =>
      isBefore(file, policy.effectiveAt!) &&
      isAccessible(file) &&
      !attemptedIds.has(file.id)
  );
  const batch = candidates.slice(0, Math.min(capacity, rateCapacity));

  for (const file of batch) {
    await trigger(
      {
        downloadableFileId: file.id,
        event: policy.event,
        models,
      },
      {
        execution: {
          trigger: PluginPipelineRunTrigger.Campaign,
          initiatedByUsername: campaign.createdByUsername,
          policyId: campaign.policyId,
          campaignId: campaign.id,
        },
      }
    );
  }

  const refreshedAttempts = (await models.PluginPipelineRun.find({
    where: { campaignId: campaign.id },
    selectionSet: `{ targetId status createdAt }`,
  })) as CampaignAttempt[];
  const refreshedCounts = campaignCounts(refreshedAttempts);
  const finished =
    candidates.length <= batch.length && refreshedCounts.runningCount === 0;
  await models.PluginPipelineCampaign.update({
    where: { id: campaign.id },
    update: {
      ...refreshedCounts,
      ...(finished
        ? {
            status: PluginPipelineCampaignStatus.Completed,
            finishedAt: now.toISOString(),
          }
        : {}),
    },
  });

  return { startedCount: batch.length, finished, ...refreshedCounts };
};

export const processRunningPipelineCampaigns = async (
  models: CampaignModels,
  now = new Date()
) => {
  const campaigns = await models.PluginPipelineCampaign.find({
    where: { status: PluginPipelineCampaignStatus.Running },
    selectionSet: `{
      id policyId eventType scope channelId applicability enforcementBehavior
      status concurrency rateLimitPerMinute affectedFileCount accessibleFileCount
      unavailableFileCount estimatedProviderRuns completedCount runningCount
      failedCount timedOutCount createdByUsername createdAt updatedAt startedAt
      pausedAt finishedAt
    }`,
  });
  for (const campaign of campaigns) {
    await runPipelineCampaign({ models, campaign, now });
  }
  return campaigns.length;
};

export class PluginPipelineCampaignService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly models: CampaignModels,
    private readonly intervalMs = 10_000
  ) {}

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await processRunningPipelineCampaigns(this.models);
    } finally {
      this.running = false;
    }
  }

  async start() {
    await this.tick();
    this.timer = setInterval(() => {
      this.tick().catch(error => {
        logger.error("Plugin pipeline campaign processing failed", {
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
