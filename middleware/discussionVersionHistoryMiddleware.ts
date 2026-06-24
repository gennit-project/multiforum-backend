/**
 * Middleware for tracking discussion version history
 * This middleware runs before discussion update operations to capture the previous
 * values of title and body before they are updated.
 */

// Import the handler function that contains the version history logic
import {
  discussionEditNotificationHandler,
  discussionVersionHistoryHandler,
} from "../hooks/discussionVersionHistoryHook.js";
import {
  notifyDiscussionMentions,
  type DiscussionSnapshot,
} from "../hooks/userMentionNotificationHook.js";
import { GraphQLResolveInfo } from 'graphql';
import type { GraphQLContext } from "../types/context.js";

// Define types for the middleware
interface UpdateDiscussionsArgs {
  where?: {
    id?: string;
  };
  update?: {
    title?: string;
    body?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
interface UpdateDiscussionWithChannelConnectionsArgs {
  where?: {
    id?: string;
  };
  discussionUpdateInput?: {
    title?: string;
    body?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Define the middleware
const discussionVersionHistoryMiddleware = {
  Mutation: {
    // Apply to the auto-generated updateDiscussions mutation
    updateDiscussions: async (
      resolve: (parent: unknown, args: UpdateDiscussionsArgs, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<unknown>,
      parent: unknown,
      args: UpdateDiscussionsArgs,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      // Extract the parameters that we need for version history tracking
      const { where, update } = args;
      if (!update) {
        return resolve(parent, args, context, info);
      }
      const discussionId = where?.id;
      let discussionSnapshot: DiscussionSnapshot | null = null;

      // Check if title or body is being updated
      if (update.title !== undefined || update.body !== undefined) {
        if (discussionId) {
          const DiscussionModel = context.ogm.model("Discussion");
          const discussions = await DiscussionModel.find({
            where: { id: discussionId },
            selectionSet: `{
              id
              title
              body
              Author {
                username
              }
              BodyLastEditedBy {
                username
              }
              DiscussionChannels {
                channelUniqueName
              }
              PastTitleVersions {
                id
                body
                createdAt
              }
              PastBodyVersions {
                id
                body
                createdAt
              }
            }`,
          });
          discussionSnapshot = (discussions[0] as unknown as DiscussionSnapshot) ?? null;
        }

        if (discussionSnapshot) {
          // Run the version history handler before the update
          await discussionVersionHistoryHandler({
            context,
            params: { where, update },
            discussionSnapshot,
          });
        }
      }
      
      // Continue with the standard resolver
      const result = await resolve(parent, args, context, info);

      if (discussionSnapshot && discussionId) {
        await discussionEditNotificationHandler({
          context,
          params: { where, update },
          discussionSnapshot,
        });

        const previousText = `${discussionSnapshot.title || ''}\n${discussionSnapshot.body || ''}`.trim();
        const nextText = `${update.title ?? discussionSnapshot.title ?? ''}\n${update.body ?? discussionSnapshot.body ?? ''}`.trim();

        await notifyDiscussionMentions({
          context,
          discussion: discussionSnapshot,
          previousText,
          nextText,
        });
      }

      return result;
    },
    updateDiscussionWithChannelConnections: async (
      resolve: (parent: unknown, args: UpdateDiscussionWithChannelConnectionsArgs, context: GraphQLContext, info: GraphQLResolveInfo) => Promise<unknown>,
      parent: unknown,
      args: UpdateDiscussionWithChannelConnectionsArgs,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const { where, discussionUpdateInput } = args;
      if (!discussionUpdateInput) {
        return resolve(parent, args, context, info);
      }
      const discussionId = where?.id;
      let discussionSnapshot: DiscussionSnapshot | null = null;

      const isTitleUpdated = discussionUpdateInput.title !== undefined;
      const isBodyUpdated = discussionUpdateInput.body !== undefined;

      if ((isTitleUpdated || isBodyUpdated) && discussionId) {
        const DiscussionModel = context.ogm.model("Discussion");
        const discussions = await DiscussionModel.find({
          where: { id: discussionId },
          selectionSet: `{
            id
            title
            body
            Author {
              username
              displayName
            }
            DiscussionChannels {
              channelUniqueName
            }
          }`,
        });
        discussionSnapshot = (discussions[0] as unknown as DiscussionSnapshot) ?? null;
      }

      const result = await resolve(parent, args, context, info);

      if (discussionSnapshot) {
        const previousText = `${discussionSnapshot.title || ''}\n${discussionSnapshot.body || ''}`.trim();
        const nextText = `${discussionUpdateInput.title ?? discussionSnapshot.title ?? ''}\n${discussionUpdateInput.body ?? discussionSnapshot.body ?? ''}`.trim();

        await notifyDiscussionMentions({
          context,
          discussion: discussionSnapshot,
          previousText,
          nextText,
        });
      }

      return result;
    },
  },
};

export default discussionVersionHistoryMiddleware;
