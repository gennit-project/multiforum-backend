import type {Driver} from "neo4j-driver";
import {createCampaignControlRepository,type CampaignControlRepository} from "../../services/persistence/campaignControlRepository.js";
import type {CampaignServiceRepository} from "../../services/persistence/campaignServiceRepository.js";
import { GraphQLError } from "graphql";
import type {
  PluginPipelineCampaignModel,
  ServerConfigModel,
  DownloadableFileModel,
} from "../../ogm_types.js";
import {
  PipelineApplicability,
  PluginPipelineCampaignStatus,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { previewPipelineCampaign } from "../../services/plugin/pipelineCampaign.js";

type Models = {
  driver?: Driver;
  controlRepository?: CampaignControlRepository;
  campaignRepository?: CampaignServiceRepository;
  PluginPipelineCampaign: PluginPipelineCampaignModel;
  DownloadableFile: DownloadableFileModel;
  ServerConfig: ServerConfigModel;
};

const validateLimit = (name: string, value: number, maximum: number) => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new GraphQLError(`${name} must be between 1 and ${maximum}`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
};

export const createPluginPipelineCampaign = (models: Models) =>
  async (
    _parent: unknown,
    {
      policyId,
      concurrency,
      rateLimitPerMinute,
    }: {
      policyId: string;
      concurrency: number;
      rateLimitPerMinute: number;
    },
    context: GraphQLContext
  ) => {
    const createdByUsername = context.user?.username;
    if (!createdByUsername) {
      throw new GraphQLError("Authentication required", {
        extensions: { code: "UNAUTHENTICATED" },
      });
    }
    validateLimit("concurrency", concurrency, 20);
    validateLimit("rateLimitPerMinute", rateLimitPerMinute, 1_000);
    const repository = models.controlRepository ?? createCampaignControlRepository(context.driver);
    const existing = await repository.findActive(policyId);
    if (existing[0]) {
      throw new GraphQLError("An active campaign already exists for this policy", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    const preview = await previewPipelineCampaign({ ...models, driver: context.driver, policyId });
    const timestamp = new Date().toISOString();
    const result = await repository.create([{
        ...preview,
        applicability:
          preview.applicability === "ALL_FILES_IMMEDIATE"
            ? PipelineApplicability.AllFilesImmediate
            : PipelineApplicability.AllFilesGradual,
        scope: "SERVER",
        channelId: null,
        status: PluginPipelineCampaignStatus.Running,
        concurrency,
        rateLimitPerMinute,
        completedCount: 0,
        runningCount: 0,
        failedCount: 0,
        timedOutCount: 0,
        createdByUsername,
        startedAt: timestamp,
        updatedAt: timestamp,
      }]);
    return result.pluginPipelineCampaigns[0];
  };

const changeCampaignStatus = (
  models: Pick<Models, "PluginPipelineCampaign" | "driver" | "controlRepository">,
  status: PluginPipelineCampaignStatus
) =>
  async (_parent: unknown, { campaignId }: { campaignId: string }) => {
    const repository = models.controlRepository ?? createCampaignControlRepository(models.driver!);
    const current = await repository.findStatus(campaignId);
    if (!current[0]) {
      throw new GraphQLError("Campaign not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    const allowed =
      status === PluginPipelineCampaignStatus.Paused
        ? current[0].status === PluginPipelineCampaignStatus.Running
        : current[0].status === PluginPipelineCampaignStatus.Paused;
    if (!allowed) {
      throw new GraphQLError("Campaign cannot make that transition", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    const timestamp = new Date().toISOString();
    const result = await repository.updateStatus(campaignId, {
        status,
        ...(status === PluginPipelineCampaignStatus.Paused
          ? { pausedAt: timestamp }
          : { pausedAt: null }),
      });
    return result.pluginPipelineCampaigns[0];
  };

export const pausePluginPipelineCampaign = (models: Models) =>
  changeCampaignStatus(models, PluginPipelineCampaignStatus.Paused);

export const resumePluginPipelineCampaign = (models: Models) =>
  changeCampaignStatus(models, PluginPipelineCampaignStatus.Running);
