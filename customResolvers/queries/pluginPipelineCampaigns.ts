import {createCampaignQueryRepository,type CampaignQueryRepository} from "../../services/persistence/campaignQueryRepository.js";
import type {Driver} from "neo4j-driver";
import type {CampaignServiceRepository} from "../../services/persistence/campaignServiceRepository.js";
import type {
  DownloadableFileModel,
  PluginPipelineCampaignModel,
  ServerConfigModel,
  PluginPipelineRunModel,
} from "../../ogm_types.js";
import { previewPipelineCampaign } from "../../services/plugin/pipelineCampaign.js";

export const previewPluginPipelineCampaign = ({
  driver,
  campaignRepository,
  DownloadableFile,
  ServerConfig,
}: {
  driver?: Driver;
  campaignRepository?: CampaignServiceRepository;
  DownloadableFile: DownloadableFileModel;
  ServerConfig: ServerConfigModel;
}) =>
  async (_parent: unknown, { policyId }: { policyId: string }) =>
    previewPipelineCampaign({ DownloadableFile, ServerConfig, driver, campaignRepository, policyId });

export const getPluginPipelineCampaigns = ({
  driver,
  queryRepository,
}: {
  driver?: Driver;
  queryRepository?: CampaignQueryRepository;
  PluginPipelineCampaign: PluginPipelineCampaignModel;
}) =>
  async () =>
    (queryRepository ?? createCampaignQueryRepository(driver!)).findCampaigns();

export const getPluginPipelineCampaignFailures = ({
  driver,
  queryRepository,
}: {
  driver?: Driver;
  queryRepository?: CampaignQueryRepository;
  DownloadableFile: DownloadableFileModel;
  PluginPipelineRun: PluginPipelineRunModel;
}) =>
  async (_parent: unknown, { campaignId }: { campaignId: string }) => {
    const repository = queryRepository ?? createCampaignQueryRepository(driver!);
    const attempts = await repository.findFailures(campaignId);
    const failures = [];
    for (const attempt of attempts) {
      const files = await repository.findDestination(attempt.targetId);
      const discussion = files[0]?.Discussion;
      const channel = discussion?.DiscussionChannels?.find(
        item => item.archived !== true
      )?.channelUniqueName;
      if (!discussion?.id || !channel) continue;
      failures.push({
        pipelineId: attempt.pipelineId,
        targetId: attempt.targetId,
        discussionId: discussion.id,
        channelId: channel,
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
      });
    }
    return failures;
  };
