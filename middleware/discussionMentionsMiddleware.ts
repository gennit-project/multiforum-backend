import { GraphQLResolveInfo } from 'graphql';
import { notifyDiscussionMentions } from '../hooks/userMentionNotificationHook.js';

const DISCUSSION_SELECTION_SET = `{
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
}`;

const processCreatedDiscussions = async (
  context: any,
  createdDiscussions: any[]
): Promise<void> => {
  const DiscussionModel = context?.ogm?.model('Discussion');
  if (!DiscussionModel || !createdDiscussions.length) return;

  for (const createdDiscussion of createdDiscussions) {
    const discussionId = createdDiscussion?.id;
    if (!discussionId) continue;

    const discussions = await DiscussionModel.find({
      where: { id: discussionId },
      selectionSet: DISCUSSION_SELECTION_SET,
    });

    if (!discussions.length) continue;
    const discussion = discussions[0];

    const textToParse =
      `${discussion.title || ''}\n${discussion.body || ''}`.trim();

    await notifyDiscussionMentions({
      context,
      discussion,
      previousText: null,
      nextText: textToParse,
    });
  }
};

const discussionMentionsMiddleware = {
  Mutation: {
    createDiscussions: async (
      resolve: (
        parent: unknown,
        args: any,
        context: any,
        info: GraphQLResolveInfo
      ) => Promise<any>,
      parent: unknown,
      args: any,
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);

      try {
        const createdDiscussions = result?.discussions || [];
        await processCreatedDiscussions(context, createdDiscussions);
      } catch (error) {
        console.warn(
          'Discussion user mention notification failed:',
          (error as any)?.message || error
        );
      }

      return result;
    },
    createDiscussionWithChannelConnections: async (
      resolve: (
        parent: unknown,
        args: any,
        context: any,
        info: GraphQLResolveInfo
      ) => Promise<any>,
      parent: unknown,
      args: any,
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);

      try {
        const createdDiscussions = Array.isArray(result)
          ? result
          : result?.discussions || [];
        await processCreatedDiscussions(context, createdDiscussions);
      } catch (error) {
        console.warn(
          'Discussion user mention notification failed:',
          (error as any)?.message || error
        );
      }

      return result;
    },
  },
};

export default discussionMentionsMiddleware;
