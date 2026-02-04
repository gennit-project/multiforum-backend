import { GraphQLResolveInfo } from 'graphql';
import { notifyNewUserMentions } from '../hooks/userMentionNotificationHook.js';

const discussionMentionsMiddleware = {
  Mutation: {
    createDiscussions: async (
      resolve: (parent: unknown, args: any, context: any, info: GraphQLResolveInfo) => Promise<any>,
      parent: unknown,
      args: any,
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);

      try {
        const createdDiscussions = result?.discussions || [];
        const DiscussionModel = context?.ogm?.model('Discussion');

        if (!DiscussionModel || !createdDiscussions.length) {
          return result;
        }

        for (const createdDiscussion of createdDiscussions) {
          const discussionId = createdDiscussion?.id;
          if (!discussionId) continue;

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
            }`
          });

          if (!discussions.length) continue;
          const discussion = discussions[0];

          const authorUsername = discussion.Author?.username || null;
          const authorLabel = discussion.Author?.displayName || authorUsername || 'Someone';
          const channelUniqueName = discussion.DiscussionChannels?.[0]?.channelUniqueName || null;

          const textToParse = `${discussion.title || ''}\n${discussion.body || ''}`.trim();

          await notifyNewUserMentions({
            context,
            mentionContext: {
              type: 'discussion',
              discussionId: discussion.id,
              title: discussion.title || 'discussion',
              channelUniqueName,
              authorUsername,
              authorLabel
            },
            previousText: null,
            nextText: textToParse
          });
        }
      } catch (error) {
        console.warn('Discussion user mention notification failed:', (error as any)?.message || error);
      }

      return result;
    }
    ,
    createDiscussionWithChannelConnections: async (
      resolve: (parent: unknown, args: any, context: any, info: GraphQLResolveInfo) => Promise<any>,
      parent: unknown,
      args: any,
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);

      try {
        const createdDiscussions = Array.isArray(result)
          ? result
          : (result?.discussions || []);
        const DiscussionModel = context?.ogm?.model('Discussion');

        if (!DiscussionModel || !createdDiscussions.length) {
          return result;
        }

        for (const createdDiscussion of createdDiscussions) {
          const discussionId = createdDiscussion?.id;
          if (!discussionId) continue;

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
            }`
          });

          if (!discussions.length) continue;
          const discussion = discussions[0];

          const authorUsername = discussion.Author?.username || null;
          const authorLabel = discussion.Author?.displayName || authorUsername || 'Someone';
          const channelUniqueName = discussion.DiscussionChannels?.[0]?.channelUniqueName || null;

          const textToParse = `${discussion.title || ''}\n${discussion.body || ''}`.trim();

          await notifyNewUserMentions({
            context,
            mentionContext: {
              type: 'discussion',
              discussionId: discussion.id,
              title: discussion.title || 'discussion',
              channelUniqueName,
              authorUsername,
              authorLabel
            },
            previousText: null,
            nextText: textToParse
          });
        }
      } catch (error) {
        console.warn('Discussion user mention notification failed:', (error as any)?.message || error);
      }

      return result;
    }
  }
};

export default discussionMentionsMiddleware;
