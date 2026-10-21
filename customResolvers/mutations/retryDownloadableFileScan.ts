import {createPipelineRetryRepository, type PipelineRetryRepository} from "../../services/persistence/pipelineRetryRepository.js";
import { PluginPipelineRunStatus } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  hasChannelModPermission,
  ModChannelPermission,
} from "../../rules/permission/hasChannelModPermission.js";
import { triggerPluginRunsForDownloadableFile } from "../../services/pluginRunner.js";
import { createRerunPluginPipelineResolver, type RerunPluginPipelineInput } from "./rerunPluginPipeline.js";

export type RetryDownloadableFileScanInput = RerunPluginPipelineInput & { retryRepository?: PipelineRetryRepository };

type FileRecord = {
  uploadedByUsername?: string | null;
  scanStatus?: string | null;
  Discussion?: {
    id?: string | null;
    Author?: { username?: string | null } | null;
    DiscussionChannels?: Array<{
      channelUniqueName?: string | null;
      archived?: boolean | null;
    }>;
  } | null;
};

export const createRetryDownloadableFileScanResolver = (
  input: RetryDownloadableFileScanInput,
  checkChannelModPermission: typeof hasChannelModPermission =
    hasChannelModPermission,
  triggerRuns: typeof triggerPluginRunsForDownloadableFile =
    triggerPluginRunsForDownloadableFile,
  createRerunResolver: typeof createRerunPluginPipelineResolver =
    createRerunPluginPipelineResolver
) => {
  return async (
    _parent: unknown,
    { downloadableFileId }: { downloadableFileId: string },
    context: GraphQLContext
  ) => {
    const repository = input.retryRepository ?? createPipelineRetryRepository(context.driver);

    const files = await repository.findScanTarget(downloadableFileId) as FileRecord[];
    const file = files[0];

    if (!file) throw new Error("Downloadable file not found");
    if (file.scanStatus === "CLEAN") {
      throw new Error("A clean downloadable file does not need another scan");
    }

    const username = context.user?.username;
    const isCreator = Boolean(username) && (
      file.uploadedByUsername === username ||
      file.Discussion?.Author?.username === username
    );
    if (!isCreator) {
      let canReview = false;
      const channelNames = (file.Discussion?.DiscussionChannels || [])
        .filter(item => item.archived !== true)
        .map(item => item.channelUniqueName)
        .filter((name): name is string => Boolean(name));
      for (const channelName of channelNames) {
        const permissionResult = await checkChannelModPermission({
          permission: ModChannelPermission.canEditDiscussions,
          channelName,
          context,
        });
        if (permissionResult === true) {
          canReview = true;
          break;
        }
      }
      if (canReview !== true) throw new Error("Not authorized to retry this scan");
    }

    const serverAttempts = await repository.findFailedAttempts({
        targetId: downloadableFileId,
        targetType: "DownloadableFile",
        eventType_IN: [
          "downloadableFile.created",
          "downloadableFile.updated",
        ],
        status_IN: [
          PluginPipelineRunStatus.Failed,
          PluginPipelineRunStatus.TimedOut,
          PluginPipelineRunStatus.Cancelled,
        ],
      });
    const channelAttempts = file.Discussion?.id
      ? await repository.findFailedAttempts({
            targetId: file.Discussion.id,
            targetType: "Discussion",
            eventType: "discussionChannel.created",
            status_IN: [
              PluginPipelineRunStatus.Failed,
              PluginPipelineRunStatus.TimedOut,
              PluginPipelineRunStatus.Cancelled,
            ],
          })
      : [];
    const attempts = [...serverAttempts, ...channelAttempts];
    const sourceAttempt = [...attempts].sort(
      (left, right) =>
        Date.parse(String(right.createdAt)) -
        Date.parse(String(left.createdAt))
    )[0];
    if (sourceAttempt) {
      const rerun = createRerunResolver(
        input,
        checkChannelModPermission,
        triggerRuns
      );
      const newAttempt = await rerun(
        _parent,
        { pipelineRunId: sourceAttempt.pipelineId },
        context
      );
      return repository.findRetryJobs(newAttempt.pipelineId);
    }

    return triggerRuns({
      driver: context.driver,
      downloadableFileId,
      event: "downloadableFile.updated",
    });
  };
};

export default createRetryDownloadableFileScanResolver;
