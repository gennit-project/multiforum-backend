import { GraphQLResolveInfo } from 'graphql';
import type { GraphQLContext } from '../types/context.js';
import {
  notifyCommentMentions,
  type CommentSnapshot,
} from '../hooks/userMentionNotificationHook.js';

const COMMENT_SELECTION_SET = `{
  id
  text
  CommentAuthor {
    ... on User {
      username
      displayName
    }
    ... on ModerationProfile {
      displayName
      User {
        username
      }
    }
  }
  DiscussionChannel {
    discussionId
    channelUniqueName
    Discussion {
      id
      title
    }
  }
  Event {
    id
    title
    EventChannels {
      channelUniqueName
    }
  }
}`;

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
        const CommentModel = context?.ogm?.model('Comment');

        if (!CommentModel || !createdComments.length) {
          return result;
        }

        for (const createdComment of createdComments) {
          const commentId = createdComment?.id;
          if (!commentId) continue;

          const comments = await CommentModel.find({
            where: { id: commentId },
            selectionSet: COMMENT_SELECTION_SET,
          });

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
        console.warn(
          'Comment user mention notification failed:',
          error instanceof Error ? error.message : error
        );
      }

      return result;
    },
  },
};

export default commentUserMentionsMiddleware;
