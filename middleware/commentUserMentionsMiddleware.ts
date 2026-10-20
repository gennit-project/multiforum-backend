import { resolveNotificationSnapshotRepository } from "../services/persistence/notificationSnapshotRepository.js";
import { GraphQLResolveInfo } from 'graphql';
import type { GraphQLContext } from '../types/context.js';
import { logger } from "../logger.js";
import {
  notifyCommentMentions,
  type CommentSnapshot,
} from '../hooks/userMentionNotificationHook.js';



const commentUserMentionsMiddleware = {
  Mutation: {
    createComments: async (
      resolve: (
        parent: unknown,
        args: unknown,
        context: GraphQLContext,
        info: GraphQLResolveInfo
      ) => Promise<{ comments?: { id?: string }[] } | undefined>,
      parent: unknown,
      args: unknown,
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);

      try {
        const createdComments = result?.comments || [];

        if ((!context?.driver && !context?.notificationSnapshotRepository) || !createdComments.length) {
          return result;
        }

        for (const createdComment of createdComments) {
          const commentId = createdComment?.id;
          if (!commentId) continue;

          const comments = await resolveNotificationSnapshotRepository(context).findCommentMentionSnapshot(commentId);

          if (!comments.length) continue;
          const comment = comments[0] as unknown as CommentSnapshot;

          await notifyCommentMentions({
            context,
            comment,
            previousText: null,
            nextText: comment.text,
          });
        }
      } catch (error) {
        logger.warn(
          'Comment user mention notification failed:',
          error instanceof Error ? error.message : error
        );
      }

      return result;
    },
  },
};

export default commentUserMentionsMiddleware;
