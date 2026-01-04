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
import { GraphQLResolveInfo } from 'graphql';

// Define types for the middleware
interface UpdateDiscussionsArgs {
  where: {
    id?: string;
  };
  update: {
    title?: string;
    body?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface Context {
  ogm: any;
  driver: any;
  [key: string]: any;
}

// Define the middleware
const discussionVersionHistoryMiddleware = {
  Mutation: {
    // Apply to the auto-generated updateDiscussions mutation
    updateDiscussions: async (
      resolve: (parent: unknown, args: UpdateDiscussionsArgs, context: Context, info: GraphQLResolveInfo) => Promise<any>,
      parent: unknown,
      args: UpdateDiscussionsArgs,
      context: Context,
      info: GraphQLResolveInfo
    ) => {
      // Extract the parameters that we need for version history tracking
      const { where, update } = args;
      const discussionId = where?.id;
      let discussionSnapshot = null;
      
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
          discussionSnapshot = discussions[0] ?? null;
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

      if (discussionSnapshot) {
        await discussionEditNotificationHandler({
          context,
          params: { where, update },
          discussionSnapshot,
        });
      }

      return result;
    }
  }
};

export default discussionVersionHistoryMiddleware;
