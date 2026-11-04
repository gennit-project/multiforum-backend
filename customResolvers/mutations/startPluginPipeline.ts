import {createPipelineStartRepository, type PipelineStartRepository} from "../../services/persistence/pipelineStartRepository.js";
import { createContentRevisionHash } from "../../services/plugin/moderationJobIdentity.js";
import { GraphQLError } from "graphql";
import {
  PluginPipelineRunStatus,
  PluginPipelineRunTrigger,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  hasChannelModPermission,
  ModChannelPermission,
} from "../../rules/permission/hasChannelModPermission.js";
import {
  triggerChannelPluginPipeline,
  triggerPluginRunsForDownloadableFile,
} from "../../services/pluginRunner.js";
import { resolveDownloadPipelinePlan } from "../../services/plugin/downloadPipelinePlan.js";
import {
  generatePipelineId,
  parseStoredPipelines,
} from "../../services/plugin/pipelineUtils.js";
import type {
  EventPipeline,
} from "../../services/plugin/types.js";

export type StartPluginPipelineInput = { startRepository?: PipelineStartRepository };

type StartPluginPipelineArgs = {
  targetId: string;
  targetType: string;
  eventType: string;
  channelId?: string | null;
};

const userInputError = (message: string) =>
  new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });

export const createStartPluginPipelineResolver = (
  input: StartPluginPipelineInput,
  checkChannelModPermission: typeof hasChannelModPermission =
    hasChannelModPermission,
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

    const repository = input.startRepository ?? createPipelineStartRepository(context.driver);

    let ownerUsername: string | null | undefined;
    let uploaderUsername: string | null | undefined;
    let uploadedAt: string | null | undefined;
    let targetVersion: string | null | undefined;
    let scope: "SERVER" | "CHANNEL";
    let channelId: string | null = null;
    let moderationChannelNames: string[] = [];
    let pipelines: EventPipeline[] = [];

    if (targetType === "DownloadableFile") {
      const files = (await repository.findFileTarget(targetId));
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
      targetVersion = uploadedAt;
      moderationChannelNames = (file.Discussion?.DiscussionChannels || [])
        .filter(item => item.archived !== true)
        .map(item => item.channelUniqueName)
        .filter((name): name is string => Boolean(name));
    } else if (targetType === "Discussion") {
      if (!requestedChannelId) {
        throw userInputError(
          "A channelId is required to start a channel pipeline"
        );
      }
      const discussions = (await repository.findDiscussionTarget(targetId));
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
      const channels = await repository.findChannelPlan(requestedChannelId);
      const channel = channels[0];
      if (!channel) {
        throw new GraphQLError("Pipeline target not found", {
          extensions: { code: "NOT_FOUND" },
        });
      }
      scope = "CHANNEL";
      channelId = requestedChannelId;
      moderationChannelNames = [requestedChannelId];
      pipelines = parseStoredPipelines(channel.pluginPipelines);
      ownerUsername = discussion.Author?.username;
      // Match the channel runner's existing single-attachment projection.
      const file = discussion.DownloadableFiles?.[0];
      uploaderUsername = file?.uploadedByUsername;
      uploadedAt = file?.uploadedAt || file?.createdAt;
      targetVersion = createContentRevisionHash({
        channelUniqueName: requestedChannelId,
        contentId: discussion.id,
        contentType: "Discussion",
        title: discussion.title,
        body: discussion.body,
        attachmentVersion: uploadedAt,
      });
    } else {
      throw userInputError(
        "Manual pipeline starts require a DownloadableFile or Discussion target"
      );
    }

    const isOwner =
      ownerUsername === username || uploaderUsername === username;
    if (!isOwner) {
      let canModerate = false;
      for (const channelName of moderationChannelNames) {
        const permissionResult = await checkChannelModPermission({
          permission: ModChannelPermission.canEditDiscussions,
          channelName,
          context,
        });
        if (permissionResult === true) {
          canModerate = true;
          break;
        }
      }
      if (canModerate !== true) {
        throw new GraphQLError("Not authorized to start this pipeline", {
          extensions: { code: "FORBIDDEN" },
        });
      }
    }

    const configs = await repository.findServerPlan();
    const config = configs[0];
    if (scope === "SERVER") {
      pipelines = parseStoredPipelines(config?.pluginPipelines);
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
          )
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

    const activeAttempts = await repository.findActiveAttempts({
        targetId: { eq: targetId },
        targetType: { eq: targetType },
        ...(targetVersion ? {
          targetVersion: targetType === "Discussion" && uploadedAt
            ? { in: [targetVersion, uploadedAt] }
            : { eq: targetVersion },
        } : {}),
        eventType: { eq: eventType },
        scope: { eq: scope },
        ...(channelId ? { channelId: { eq: channelId } } : {}),
        status: { in: [
          PluginPipelineRunStatus.Queued,
          PluginPipelineRunStatus.Running,
        ] },
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
          driver: context.driver,
          downloadableFileId: targetId,
          event: eventType,
        },
        { execution }
      );
    } else {
      await triggerChannelRuns(
        {
          driver: context.driver,
          discussionId: targetId,
          channelUniqueName: channelId as string,
          event: eventType,
        },
        { execution }
      );
    }

    const attempts = await repository.findStartedAttempt(pipelineId);
    if (!attempts[0]) {
      throw new Error("Pipeline runner did not create an attempt");
    }
    return attempts[0];
  };
};

export default createStartPluginPipelineResolver;
