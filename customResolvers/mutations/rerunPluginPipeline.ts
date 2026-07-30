import { GraphQLError } from "graphql";
import type {
  ChannelModel,
  DiscussionModel,
  DownloadableFileModel,
  PluginModel,
  PluginPipelineRun,
  PluginPipelineRunModel,
  PluginRunModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel,
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
import { createStartPluginPipelineResolver } from "./startPluginPipeline.js";

const RETRY_COOLDOWN_MS = 60_000;
const RETRY_RATE_WINDOW_MS = 60 * 60_000;
const MAX_RETRIES_PER_WINDOW = 3;
const RETRY_TRIGGERS = new Set<PluginPipelineRunTrigger>([
  PluginPipelineRunTrigger.OwnerRetry,
  PluginPipelineRunTrigger.ModeratorRetry,
  PluginPipelineRunTrigger.AutomaticRetry,
]);
const ELIGIBLE_STATUSES = new Set<PluginPipelineRunStatus>([
  PluginPipelineRunStatus.Failed,
  PluginPipelineRunStatus.TimedOut,
  PluginPipelineRunStatus.Cancelled,
]);

type Input = {
  Channel: ChannelModel;
  Discussion: DiscussionModel;
  DownloadableFile: DownloadableFileModel;
  Plugin: PluginModel;
  PluginVersion: PluginVersionModel;
  PluginPipelineRun: PluginPipelineRunModel;
  PluginRun: PluginRunModel;
  ServerConfig: ServerConfigModel;
  ServerSecret: ServerSecretModel;
};

type AttemptRecord = Pick<
  PluginPipelineRun,
  | "pipelineId"
  | "targetId"
  | "targetType"
  | "targetVersion"
  | "eventType"
  | "scope"
  | "channelId"
  | "status"
  | "trigger"
  | "createdAt"
>;

const userInputError = (message: string) =>
  new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });

const timestamp = (value: unknown): number => Date.parse(String(value));

export const createRerunPluginPipelineResolver = (
  input: Input,
  checkServerModPermission: typeof hasServerModPermission = hasServerModPermission,
  triggerDownloadRuns: typeof triggerPluginRunsForDownloadableFile =
    triggerPluginRunsForDownloadableFile,
  triggerChannelRuns: typeof triggerChannelPluginPipeline =
    triggerChannelPluginPipeline,
  now: () => number = Date.now
) => {
  return async (
    _parent: unknown,
    { pipelineRunId }: { pipelineRunId: string },
    context: GraphQLContext
  ) => {
    const sourceAttempts = (await input.PluginPipelineRun.find({
      where: { pipelineId: pipelineRunId },
      selectionSet: `{
        pipelineId targetId targetType targetVersion eventType scope channelId
        status trigger createdAt
      }`,
    })) as AttemptRecord[];
    const source = sourceAttempts[0];
    if (!source) {
      throw new GraphQLError("Pipeline attempt not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    if (!ELIGIBLE_STATUSES.has(source.status)) {
      throw userInputError(
        "Only failed, timed out, or cancelled pipelines can be run again"
      );
    }
    if (source.targetVersion) {
      let currentTargetVersion: string | null | undefined;
      if (source.targetType === "DownloadableFile") {
        const files = await input.DownloadableFile.find({
          where: { id: source.targetId },
          selectionSet: `{ uploadedAt createdAt }`,
        });
        currentTargetVersion =
          files[0]?.uploadedAt || files[0]?.createdAt || null;
      } else if (source.targetType === "Discussion") {
        const discussions = await input.Discussion.find({
          where: { id: source.targetId },
          selectionSet: `{
            DownloadableFile { uploadedAt createdAt }
          }`,
        });
        const discussion = discussions[0] as unknown as {
          DownloadableFile?: {
            uploadedAt?: string | null;
            createdAt?: string | null;
          } | null;
        };
        currentTargetVersion =
          discussion?.DownloadableFile?.uploadedAt ||
          discussion?.DownloadableFile?.createdAt ||
          null;
      }
      if (
        currentTargetVersion &&
        String(currentTargetVersion) !== source.targetVersion
      ) {
        throw userInputError(
          "This file has changed since the selected pipeline attempt"
        );
      }
    }

    const relatedAttempts = (await input.PluginPipelineRun.find({
      where: {
        targetId: source.targetId,
        targetType: source.targetType,
        ...(source.targetVersion
          ? { targetVersion: source.targetVersion }
          : {}),
        eventType: source.eventType,
        scope: source.scope,
        ...(source.channelId ? { channelId: source.channelId } : {}),
      },
      selectionSet: `{ pipelineId status trigger createdAt }`,
    })) as AttemptRecord[];
    const currentTime = now();
    const latestAttempt = [...relatedAttempts].sort(
      (left, right) =>
        (timestamp(right.createdAt) || 0) -
        (timestamp(left.createdAt) || 0)
    )[0];
    if (latestAttempt && latestAttempt.pipelineId !== source.pipelineId) {
      throw userInputError(
        "Only the latest pipeline attempt can be run again"
      );
    }
    const retryAttempts = relatedAttempts.filter(attempt =>
      RETRY_TRIGGERS.has(attempt.trigger)
    );
    const latestRetryTime = retryAttempts.reduce(
      (latest, attempt) => Math.max(latest, timestamp(attempt.createdAt) || 0),
      0
    );
    if (
      latestRetryTime > 0 &&
      currentTime - latestRetryTime < RETRY_COOLDOWN_MS
    ) {
      throw userInputError(
        "Please wait at least one minute before running this pipeline again"
      );
    }
    const retryCount = retryAttempts.filter(attempt => {
      const createdAt = timestamp(attempt.createdAt);
      return (
        Number.isFinite(createdAt) &&
        currentTime >= createdAt &&
        currentTime - createdAt < RETRY_RATE_WINDOW_MS
      );
    }).length;
    if (retryCount >= MAX_RETRIES_PER_WINDOW) {
      throw userInputError(
        "This pipeline has reached the retry limit. Please try again later"
      );
    }

    const withRetryMetadata = (
      options: Parameters<typeof triggerDownloadRuns>[1]
    ) => ({
      ...options,
      execution: {
        ...options?.execution,
        trigger:
          options?.execution?.trigger === PluginPipelineRunTrigger.OwnerStart
            ? PluginPipelineRunTrigger.OwnerRetry
            : PluginPipelineRunTrigger.ModeratorRetry,
        retryOfPipelineRunId: source.pipelineId,
      },
    });
    const startResolver = createStartPluginPipelineResolver(
      input,
      checkServerModPermission,
      ((args, options) =>
        triggerDownloadRuns(args, withRetryMetadata(options))) as typeof triggerDownloadRuns,
      ((args, options) =>
        triggerChannelRuns(
          args,
          withRetryMetadata(
            options as Parameters<typeof triggerDownloadRuns>[1]
          )
        )) as typeof triggerChannelRuns
    );

    return startResolver(
      _parent,
      {
        targetId: source.targetId,
        targetType: source.targetType,
        eventType: source.eventType,
        channelId: source.channelId,
      },
      context
    );
  };
};

export default createRerunPluginPipelineResolver;
