import type {
  DownloadableFileModel,
  PluginPipelineRunModel,
  UserModel,
} from "../../ogm_types.js";
import {
  PluginPipelineRunStatus,
  type PluginPipelineRunUpdateInput,
  type UserUpdateInput,
} from "../../ogm_types.js";

const TERMINAL = new Set<PluginPipelineRunStatus>([
  PluginPipelineRunStatus.Succeeded,
  PluginPipelineRunStatus.Failed,
  PluginPipelineRunStatus.TimedOut,
  PluginPipelineRunStatus.Cancelled,
]);

export const notifyUploaderOfPipelineResult = async ({
  DownloadableFile,
  PluginPipelineRun,
  User,
  pipelineId,
  now = () => new Date().toISOString(),
}: {
  DownloadableFile: DownloadableFileModel;
  PluginPipelineRun: PluginPipelineRunModel;
  User?: UserModel;
  pipelineId: string;
  now?: () => string;
}) => {
  if (!User) return false;
  const attempts = await PluginPipelineRun.find({
    where: { pipelineId },
    selectionSet: `{
      pipelineId targetId targetType status notifiedAt
    }`,
  });
  const attempt = attempts[0];
  if (
    !attempt ||
    attempt.targetType !== "DownloadableFile" ||
    !TERMINAL.has(attempt.status) ||
    attempt.notifiedAt
  ) {
    return false;
  }
  const files = await DownloadableFile.find({
    where: { id: attempt.targetId },
    selectionSet: `{
      id uploadedByUsername
      Discussion {
        id title
        Author { username }
        DiscussionChannels { channelUniqueName archived }
      }
    }`,
  });
  const file = files[0] as (typeof files)[number] & {
    uploadedByUsername?: string | null;
    Discussion?: {
      id?: string | null;
      title?: string | null;
      Author?: { username?: string | null } | null;
      DiscussionChannels?: Array<{
        channelUniqueName?: string | null;
        archived?: boolean | null;
      }>;
    } | null;
  };
  const username =
    file?.uploadedByUsername || file?.Discussion?.Author?.username;
  if (!username) return false;

  const timestamp = now();
  const claim = await PluginPipelineRun.update({
    where: { pipelineId, notifiedAt: null },
    update: { notifiedAt: timestamp } as PluginPipelineRunUpdateInput,
    selectionSet: `{ pluginPipelineRuns { pipelineId } }`,
  });
  if (claim.pluginPipelineRuns.length === 0) return false;

  const channel = file.Discussion?.DiscussionChannels?.find(
    item => item.archived !== true
  )?.channelUniqueName;
  const link =
    channel && file.Discussion?.id
      ? `/forums/${encodeURIComponent(channel)}/downloads/${encodeURIComponent(
          file.Discussion.id
        )}/pipelines?attempt=${encodeURIComponent(pipelineId)}#attempt-${encodeURIComponent(
          pipelineId
        )}`
      : null;
  const label =
    attempt.status === PluginPipelineRunStatus.Succeeded
      ? "passed"
      : attempt.status === PluginPipelineRunStatus.TimedOut
        ? "timed out"
        : "did not pass";
  await User.update({
    where: { username },
    update: {
      Notifications: [{
        create: [{
          node: {
            read: false,
            notificationType: "plugin_pipeline",
            text: `Checks for “${file.Discussion?.title || "your download"}” ${label}.`,
            link,
          },
        }],
      }],
    } as UserUpdateInput,
  });
  return true;
};
