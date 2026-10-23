import type { GraphQLResolveInfo } from "graphql";

import { logger } from "../logger.js";
import {
  createDiscussionRevisionRepository,
  type DiscussionSnapshot,
} from "../services/persistence/discussionRevisionRepository.js";
import { PLUGIN_EVENTS } from "../services/plugin/constants.js";
import { triggerChannelPluginPipeline } from "../services/pluginRunner.js";
import type { GraphQLContext } from "../types/context.js";

type DiscussionTextUpdate = {
  title?: string | null;
  body?: string | null;
  [key: string]: unknown;
};

type DiscussionEditArgs = {
  where?: { id?: string | null };
  update?: DiscussionTextUpdate;
  discussionUpdateInput?: DiscussionTextUpdate;
  [key: string]: unknown;
};

type Resolve = (
  parent: unknown,
  args: DiscussionEditArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

type TriggerChannelPlugins = typeof triggerChannelPluginPipeline;

const hasTextUpdate = (update: DiscussionTextUpdate | undefined) =>
  update?.title !== undefined || update?.body !== undefined;

const changesModeratedText = (
  update: DiscussionTextUpdate,
  snapshot: { title?: string | null; body?: string | null } | undefined
) =>
  !snapshot ||
  (update.title !== undefined && update.title !== snapshot.title) ||
  (update.body !== undefined && update.body !== snapshot.body);

const wrapDiscussionEdit = (
  getUpdate: (args: DiscussionEditArgs) => DiscussionTextUpdate | undefined,
  triggerChannelPlugins: TriggerChannelPlugins
) => async (
  resolve: Resolve,
  parent: unknown,
  args: DiscussionEditArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  const update = getUpdate(args);
  const discussionId = args.where?.id;
  if (!hasTextUpdate(update) || !discussionId || !context?.driver) {
    return resolve(parent, args, context, info);
  }

  const repository =
    context.discussionRevisionRepository ??
    createDiscussionRevisionRepository(context.driver);
  let before: DiscussionSnapshot | undefined;

  try {
    before = (await repository.findMentionSnapshot(discussionId))[0];
  } catch (error) {
    logger.warn(
      `Could not read discussion ${discussionId} before plugin dispatch:`,
      error instanceof Error ? error.message : error
    );
  }

  const result = await resolve(parent, args, context, info);
  if (!changesModeratedText(update!, before)) {
    return result;
  }

  let after: DiscussionSnapshot | undefined;
  try {
    after = (await repository.findMentionSnapshot(discussionId))[0];
  } catch (error) {
    logger.warn(
      `Could not read discussion ${discussionId} after plugin dispatch:`,
      error instanceof Error ? error.message : error
    );
    return result;
  }

  const channelUniqueNames = [
    ...new Set(
      (after?.DiscussionChannels || [])
        .map(channel => channel?.channelUniqueName?.trim())
        .filter((name): name is string => Boolean(name))
    ),
  ];

  for (const channelUniqueName of channelUniqueNames) {
    try {
      await triggerChannelPlugins({
        driver: context.driver,
        discussionId,
        channelUniqueName,
        event: PLUGIN_EVENTS.DISCUSSION_CHANNEL_EDITED,
      });
    } catch (error) {
      logger.warn(
        `Discussion plugin pipeline failed for ${channelUniqueName}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return result;
};

export const createDiscussionPluginPipelineMiddleware = (
  triggerChannelPlugins: TriggerChannelPlugins = triggerChannelPluginPipeline
) => ({
  Mutation: {
    updateDiscussions: wrapDiscussionEdit(
      args => args.update,
      triggerChannelPlugins
    ),
    updateDiscussionWithChannelConnections: wrapDiscussionEdit(
      args => args.discussionUpdateInput,
      triggerChannelPlugins
    ),
  },
});

export default createDiscussionPluginPipelineMiddleware();
