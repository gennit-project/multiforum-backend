import type { Driver } from "neo4j-driver";
import { createPipelineNotificationRepository, type PipelineNotificationRepository } from "../persistence/pipelineNotificationRepository.js";
import {
  PluginPipelineRunStatus,
  type UserUpdateInput,
} from "../../ogm_types.js";

const TERMINAL = new Set<PluginPipelineRunStatus>([
  PluginPipelineRunStatus.Succeeded,
  PluginPipelineRunStatus.Failed,
  PluginPipelineRunStatus.TimedOut,
  PluginPipelineRunStatus.Cancelled,
]);

export const notifyUploaderOfPipelineResult = async ({
  driver,
  repository,
  pipelineId,
  now = () => new Date().toISOString(),
}: {
  driver?: Driver;
  repository?: PipelineNotificationRepository;
  pipelineId: string;
  now?: () => string;
}) => {
  const persistence = repository ?? createPipelineNotificationRepository(driver!);
  const attempts = await persistence.findAttempt(pipelineId);
  const attempt = attempts[0];
  if (
    !attempt ||
    attempt.targetType !== "DownloadableFile" ||
    !TERMINAL.has(attempt.status) ||
    attempt.notifiedAt
  ) {
    return false;
  }
  const files = await persistence.findTargetFile(attempt.targetId);
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
  const claim = await persistence.claimNotification(pipelineId, timestamp);
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
  await persistence.createNotification({
    where: { username: { eq: username } },
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
