import type {
  DownloadableFileModel,
  PluginPipelineCampaignModel,
  ServerConfigModel,
  PluginPipelineRunModel,
} from "../../ogm_types.js";
import { PluginPipelineRunStatus } from "../../ogm_types.js";
import { previewPipelineCampaign } from "../../services/plugin/pipelineCampaign.js";

export const previewPluginPipelineCampaign = ({
  DownloadableFile,
  ServerConfig,
}: {
  DownloadableFile: DownloadableFileModel;
  ServerConfig: ServerConfigModel;
}) =>
  async (_parent: unknown, { policyId }: { policyId: string }) =>
    previewPipelineCampaign({ DownloadableFile, ServerConfig, policyId });

export const getPluginPipelineCampaigns = ({
  PluginPipelineCampaign,
}: {
  PluginPipelineCampaign: PluginPipelineCampaignModel;
}) =>
  async () =>
    PluginPipelineCampaign.find({
      selectionSet: `{
        id policyId eventType scope channelId applicability enforcementBehavior
        status concurrency rateLimitPerMinute affectedFileCount accessibleFileCount
        unavailableFileCount estimatedProviderRuns completedCount runningCount
        failedCount timedOutCount createdByUsername createdAt updatedAt startedAt
        pausedAt finishedAt
      }`,
    });

export const getPluginPipelineCampaignFailures = ({
  DownloadableFile,
  PluginPipelineRun,
}: {
  DownloadableFile: DownloadableFileModel;
  PluginPipelineRun: PluginPipelineRunModel;
}) =>
  async (_parent: unknown, { campaignId }: { campaignId: string }) => {
    const attempts = await PluginPipelineRun.find({
      where: {
        campaignId,
        status_IN: [
          PluginPipelineRunStatus.Failed,
          PluginPipelineRunStatus.TimedOut,
          PluginPipelineRunStatus.Cancelled,
        ],
      },
      selectionSet: `{ pipelineId targetId status attemptNumber }`,
    });
    const failures = [];
    for (const attempt of attempts) {
      const files = await DownloadableFile.find({
        where: { id: attempt.targetId },
        selectionSet: `{
          id
          Discussion {
            id
            DiscussionChannels { channelUniqueName archived }
          }
        }`,
      });
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
