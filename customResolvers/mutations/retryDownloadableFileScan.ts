import type {
  ModelMap,
} from "../../ogm_types.js";
import { PluginPipelineRunStatus } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { hasServerModPermission } from "../../rules/permission/hasServerModPermission.js";
import { triggerPluginRunsForDownloadableFile } from "../../services/pluginRunner.js";
import { createRerunPluginPipelineResolver } from "./rerunPluginPipeline.js";

export type RetryDownloadableFileScanInput = Pick<
  ModelMap,
  | "Channel"
  | "Discussion"
  | "DownloadableFile"
  | "Plugin"
  | "PluginVersion"
  | "PluginPipelineRun"
  | "PluginRun"
  | "ServerConfig"
  | "ServerSecret"
>;

type FileRecord = {
  uploadedByUsername?: string | null;
  scanStatus?: string | null;
  Discussion?: { Author?: { username?: string | null } | null } | null;
};

export const createRetryDownloadableFileScanResolver = (
  input: RetryDownloadableFileScanInput,
  checkServerModPermission: typeof hasServerModPermission = hasServerModPermission,
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
    const files = await input.DownloadableFile.find({
      where: { id: downloadableFileId },
      selectionSet: `{
        uploadedByUsername
        scanStatus
        Discussion { Author { username } }
      }`,
    }) as FileRecord[];
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
      const canReview = await checkServerModPermission(
        "canPermanentlyRemoveImage",
        context
      );
      if (canReview !== true) throw new Error("Not authorized to retry this scan");
    }

    const attempts = await input.PluginPipelineRun.find({
      where: {
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
      },
      selectionSet: `{ pipelineId createdAt }`,
    });
    const sourceAttempt = [...attempts].sort(
      (left, right) =>
        Date.parse(String(right.createdAt)) -
        Date.parse(String(left.createdAt))
    )[0];
    if (sourceAttempt) {
      const rerun = createRerunResolver(
        input,
        checkServerModPermission,
        triggerRuns
      );
      const newAttempt = await rerun(
        _parent,
        { pipelineRunId: sourceAttempt.pipelineId },
        context
      );
      return input.PluginRun.find({
        where: { pipelineId: newAttempt.pipelineId },
        selectionSet: `{
          id pluginId pluginName version scope channelId eventType status message
          durationMs targetId targetType payload pipelineId executionOrder
          skippedReason createdAt updatedAt
        }`,
      });
    }

    return triggerRuns({
      downloadableFileId,
      event: "downloadableFile.updated",
      models: input,
    });
  };
};

export default createRetryDownloadableFileScanResolver;
