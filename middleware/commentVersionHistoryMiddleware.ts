/**
 * Middleware for tracking comment version history
 * This middleware runs before comment update operations to capture the previous
 * values of text before they are updated.
 */

// Import the handler function that contains the version history logic
import { commentVersionHistoryHandler } from "../hooks/commentVersionHistoryHook.js";
import { GraphQLResolveInfo } from 'graphql';

// Define types for the middleware
interface UpdateCommentsArgs {
  where: {
    id?: string;
  };
  update: {
    text?: string;
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
const commentVersionHistoryMiddleware = {
  Mutation: {
    // Apply to the auto-generated updateComments mutation
    updateComments: async (
      resolve: (parent: unknown, args: UpdateCommentsArgs, context: Context, info: GraphQLResolveInfo) => Promise<any>,
      parent: unknown,
      args: UpdateCommentsArgs,
      context: Context,
      info: GraphQLResolveInfo
    ) => {
      // Extract the parameters that we need for version history tracking
      const { where, update } = args;
      let commentSnapshot = null;
      
      // Check if text is being updated
      if (update.text !== undefined) {
        const commentId = where?.id;

        if (commentId) {
          const CommentModel = context.ogm.model("Comment");
          const comments = await CommentModel.find({
            where: { id: commentId },
            selectionSet: `{
              id
              text
              CommentAuthor {
                ... on User {
                  username
                }
                ... on ModerationProfile {
                  displayName
                }
              }
              PastVersions {
                id
                body
                createdAt
              }
            }`,
          });
          commentSnapshot = comments[0] ?? null;
        }
      }

      // Continue with the standard resolver (auth failures should stop here)
      const result = await resolve(parent, args, context, info);

      // Run the version history handler only after a successful update
      if (update.text !== undefined) {
        await commentVersionHistoryHandler({
          context,
          params: { where, update },
          commentSnapshot,
        });
      }

      return result;
    }
  }
};

export default commentVersionHistoryMiddleware;
