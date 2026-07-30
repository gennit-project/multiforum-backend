import { GraphQLError } from "graphql";
import type {
  Channel as ChannelType,
  DownloadableFile as DownloadableFileType,
  ModelMap,
  ServerConfig as ServerConfigType,
} from "../../ogm_types.js";
import {
  PluginPipelineRunStatus,
  PluginPipelineRunTrigger,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { hasServerModPermission } from "../../rules/permission/hasServerModPermission.js";
import {
  triggerChannelPluginPipeline,
  triggerPluginRunsForDownloadableFile,
} from "../../services/pluginRunner.js";
import { resolveDownloadPipelinePlan } from "../../services/plugin/downloadPipelinePlan.js";
import { generatePipelineId } from "../../services/plugin/pipelineUtils.js";
import type {
  EventPipeline,
  PluginEdgeData,
} from "../../services/plugin/types.js";

export type StartPluginPipelineInput = Pick<
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
> & Partial<Pick<ModelMap, "User">>;

type StartPluginPipelineArgs = {
  targetId: string;
  targetType: string;
  eventType: string;
  channelId?: string | null;
};

type FileRecord = DownloadableFileType & {
  uploadedByUsername?: string | null;
  Discussion?: { Author?: { username?: string | null } | null } | null;
};

type DiscussionRecord = {
  id: string;
  Author?: { username?: string | null } | null;
  DownloadableFile?: {
    uploadedAt?: string | null;
    createdAt?: string | null;
    uploadedByUsername?: string | null;
  } | null;
  DiscussionChannels?: Array<{
    channelUniqueName?: string | null;
    archived?: boolean | null;
  }>;
};

const userInputError = (message: string) =>
  new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });

export const createStartPluginPipelineResolver = (
  input: StartPluginPipelineInput,
  checkServerModPermission: typeof hasServerModPermission = hasServerModPermission,
  triggerDownloadRuns: typeof triggerPluginRunsForDownloadableFile =
    triggerPluginRunsForDownloadableFile,
  triggerChannelRuns: typeof triggerChannelPluginPipeline =
    triggerChannelPluginPipeline
) => {
  return async (
    _parent: unknown,
    {
      targetId,
      targetType,
      eventType,
      channelId: requestedChannelId,
    }: StartPluginPipelineArgs,
    context: GraphQLContext
  ) => {
    const username = context.user?.username;
    if (!username) {
      throw new GraphQLError("Authentication required", {
        extensions: { code: "UNAUTHENTICATED" },
      });
    }

    let ownerUsername: string | null | undefined;
    let uploaderUsername: string | null | undefined;
    let uploadedAt: string | null | undefined;
    let scope: "SERVER" | "CHANNEL";
    let channelId: string | null = null;
    let pipelines: EventPipeline[] = [];

    if (targetType === "DownloadableFile") {
      const files = (await input.DownloadableFile.find({
        where: { id: targetId },
        selectionSet: `{
          id
          uploadedAt
          createdAt
          uploadedByUsername
          Discussion { Author { username } }
        }`,
      })) as FileRecord[];
      const file = files[0];
      if (!file) {
        throw new GraphQLError("Pipeline target not found", {
          extensions: { code: "NOT_FOUND" },
        });
      }
      scope = "SERVER";
      ownerUsername = file.Discussion?.Author?.username;
      uploaderUsername = file.uploadedByUsername;
      uploadedAt = file.uploadedAt || file.createdAt;
    } else if (targetType === "Discussion") {
      if (!requestedChannelId) {
        throw userInputError(
          "A channelId is required to start a channel pipeline"
        );
      }
      const discussions = (await input.Discussion.find({
        where: { id: targetId },
        selectionSet: `{
          id
          Author { username }
          DownloadableFile {
            uploadedAt
            createdAt
            uploadedByUsername
          }
          DiscussionChannels {
            channelUniqueName
            archived
          }
        }`,
      })) as DiscussionRecord[];
      const discussion = discussions[0];
      const belongsToChannel = discussion?.DiscussionChannels?.some(
        item =>
          item.channelUniqueName === requestedChannelId &&
          item.archived !== true
      );
      if (!discussion || !belongsToChannel) {
        throw new GraphQLError("Pipeline target not found", {
          extensions: { code: "NOT_FOUND" },
        });
      }
      const channels = await input.Channel.find({
        where: { uniqueName: requestedChannelId },
        selectionSet: `{ uniqueName pluginPipelines }`,
      });
      const channel = channels[0] as ChannelType | undefined;
      if (!channel) {
        throw new GraphQLError("Pipeline target not found", {
          extensions: { code: "NOT_FOUND" },
        });
      }
      scope = "CHANNEL";
      channelId = requestedChannelId;
      pipelines = (channel.pluginPipelines || []) as EventPipeline[];
      ownerUsername = discussion.Author?.username;
      uploaderUsername = discussion.DownloadableFile?.uploadedByUsername;
      uploadedAt =
        discussion.DownloadableFile?.uploadedAt ||
        discussion.DownloadableFile?.createdAt;
    } else {
      throw userInputError(
        "Manual pipeline starts require a DownloadableFile or Discussion target"
      );
    }

    const isOwner =
      ownerUsername === username || uploaderUsername === username;
    if (!isOwner) {
      const canModerate = await checkServerModPermission(
        "canPermanentlyRemoveImage",
        context
      );
      if (canModerate !== true) {
        throw new GraphQLError("Not authorized to start this pipeline", {
          extensions: { code: "FORBIDDEN" },
        });
      }
    }

    const configs = await input.ServerConfig.find({
      selectionSet: `{
        pluginPipelines
        InstalledVersionsConnection {
          edges {
            properties { enabled settingsJson }
            node {
              id version repoUrl tarballGsUri entryPath manifest
              settingsDefaults uiSchema
              Plugin {
                id name displayName description metadata
              }
            }
          }
        }
      }`,
    });
    const config = configs[0] as ServerConfigType | undefined;
    if (scope === "SERVER") {
      pipelines = (config?.pluginPipelines || []) as EventPipeline[];
    }
    const pipelineConfigured =
      scope === "SERVER" ||
      Boolean(
        pipelines.find(pipeline => pipeline.event === eventType)?.steps.length
      );
    const plan = resolveDownloadPipelinePlan({
      event: eventType,
      pipelines,
      installedPluginEdges: pipelineConfigured
        ? (
            config?.InstalledVersionsConnection?.edges || []
          ) as unknown as PluginEdgeData[]
        : [],
      uploadedAt,
    });

    if (!plan.required) {
      throw userInputError(
        plan.reason === "UPLOADED_BEFORE_POLICY"
          ? "This pipeline is not required for files uploaded before the policy"
          : "No required pipeline applies to this target"
      );
    }
    if (plan.pluginsToRun.length === 0) {
      throw userInputError("The applicable pipeline has no executable jobs");
    }

    const activeAttempts = await input.PluginPipelineRun.find({
      where: {
        targetId,
        targetType,
        ...(uploadedAt ? { targetVersion: uploadedAt } : {}),
        eventType,
        scope,
        ...(channelId ? { channelId } : {}),
        status_IN: [
          PluginPipelineRunStatus.Queued,
          PluginPipelineRunStatus.Running,
        ],
      },
      selectionSet: `{ pipelineId }`,
    });
    if (activeAttempts.length > 0) {
      throw userInputError("This pipeline already has an active attempt");
    }

    const pipelineId = generatePipelineId();
    const execution = {
      pipelineId,
      initiatedByUsername: username,
      trigger: isOwner
        ? PluginPipelineRunTrigger.OwnerStart
        : PluginPipelineRunTrigger.ModeratorStart,
    };
    if (scope === "SERVER") {
      await triggerDownloadRuns(
        {
          downloadableFileId: targetId,
          event: eventType,
          models: input,
        },
        { execution }
      );
    } else {
      await triggerChannelRuns(
        {
          discussionId: targetId,
          channelUniqueName: channelId as string,
          event: eventType,
          models: input,
        },
        { execution }
      );
    }

    const attempts = await input.PluginPipelineRun.find({
      where: { pipelineId },
      selectionSet: `{
        pipelineId targetId targetType targetVersion eventType scope channelId status trigger
        initiatedByUsername retryOfPipelineRunId attemptNumber
        configurationSnapshot applicability policyEffectiveAt policyId campaignId
        queuedAt startedAt heartbeatAt timeoutAt finishedAt createdAt updatedAt
      }`,
    });
    if (!attempts[0]) {
      throw new Error("Pipeline runner did not create an attempt");
    }
    return attempts[0];
  };
};

export default createStartPluginPipelineResolver;
