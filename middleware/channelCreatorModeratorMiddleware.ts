import { GraphQLResolveInfo } from 'graphql';
import type { GraphQLContext } from '../types/context.js';
import type { ChannelCreateInput } from '../ogm_types.js';
import { logger } from "../logger.js";
import {
  setUserDataOnContext,
  type AuthContextForUserLookup,
} from '../rules/permission/userDataHelperFunctions.js';

interface CreateChannelsArgs {
  input?: ChannelCreateInput[];
  [key: string]: unknown;
}

interface CreateChannelsResult {
  channels?: Array<{
    uniqueName: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

const channelCreatorModeratorMiddleware = {
  Mutation: {
    createChannels: async (
      resolve: (parent: unknown, args: CreateChannelsArgs, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<CreateChannelsResult>,
      parent: unknown,
      args: CreateChannelsArgs,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ): Promise<CreateChannelsResult> => {
      // 1. Execute original resolver to create the channel(s)
      const result = await resolve(parent, args, context, info);

      // 2. Get logged-in user's ModerationProfile displayName
      try {
        const userData = await setUserDataOnContext({
          context: context as AuthContextForUserLookup,
        });

        if (!userData?.username) {
          logger.warn('⚠️ No logged-in user found for channel creation, skipping moderator assignment');
          return result;
        }

        const displayName = userData.data?.ModerationProfile?.displayName;

        if (!displayName) {
          logger.warn(`⚠️ User ${userData.username} has no ModerationProfile, skipping moderator assignment`);
          return result;
        }

        // 3. For each created channel, add creator as moderator
        const channels = result?.channels;
        if (!channels || channels.length === 0) {
          return result;
        }

        const assignment = context.channelCreatorModeratorService;
        if (!assignment) throw new Error("Creator moderator assignment service is missing");

        for (const channel of channels) {
          if (!channel?.uniqueName) {
            continue;
          }

          try {
            await assignment.assign(channel.uniqueName, displayName);

            logger.info(`✅ Added creator ${displayName} as moderator of channel ${channel.uniqueName}`);
          } catch (error) {
            // Log the error but don't fail the channel creation
            logger.error(
              `❌ Failed to add creator as moderator for channel ${channel.uniqueName}:`,
              error instanceof Error ? error.message : error
            );
          }
        }
      } catch (error) {
        // Log the error but don't fail the channel creation
        logger.warn(
          '⚠️ Failed to add creator as moderator:',
          error instanceof Error ? error.message : error
        );
      }

      return result;
    },
  },
};

export default channelCreatorModeratorMiddleware;
