import { GraphQLResolveInfo } from 'graphql';
import { notifyNewUserMentions } from '../hooks/userMentionNotificationHook.js';

const commentUserMentionsMiddleware = {
  Mutation: {
    createComments: async (
      resolve: (parent: unknown, args: any, context: any, info: GraphQLResolveInfo) => Promise<any>,
      parent: unknown,
      args: any,
      context: any,
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
            selectionSet: `{
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
            }`
          });

          if (!comments.length) continue;
          const comment = comments[0];

          const authorUsername =
            comment.CommentAuthor?.username ||
            comment.CommentAuthor?.User?.username ||
            null;
          const authorLabel =
            comment.CommentAuthor?.displayName ||
            authorUsername ||
            'Someone';

          const discussionContext = comment.DiscussionChannel?.discussionId
            ? {
                id: comment.DiscussionChannel.discussionId,
                title: comment.DiscussionChannel.Discussion?.title || 'discussion',
                channelUniqueName: comment.DiscussionChannel.channelUniqueName
              }
            : null;

          const eventChannelUniqueName = comment.Event?.EventChannels?.[0]?.channelUniqueName || null;
          const eventContext = comment.Event?.id && eventChannelUniqueName
            ? {
                id: comment.Event.id,
                title: comment.Event.title || 'event',
                channelUniqueName: eventChannelUniqueName
              }
            : null;

          await notifyNewUserMentions({
            context,
            mentionContext: {
              type: 'comment',
              commentId: comment.id,
              authorUsername,
              authorLabel,
              discussion: discussionContext,
              event: eventContext
            },
            previousText: null,
            nextText: comment.text
          });
        }
      } catch (error) {
        console.warn('Comment user mention notification failed:', (error as any)?.message || error);
      }

      return result;
    }
  }
};

export default commentUserMentionsMiddleware;
