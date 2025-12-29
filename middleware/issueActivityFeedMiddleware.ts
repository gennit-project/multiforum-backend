import { GraphQLResolveInfo } from 'graphql';
import {
  createIssueActivityFeedItems,
  getAttributionFromContext,
  getIssueIdsForRelated,
} from '../hooks/issueActivityFeedHelpers.js';

type Resolver = (
  parent: unknown,
  args: any,
  context: any,
  info: GraphQLResolveInfo
) => Promise<any>;

const issueHasDeleteActivity = async (
  IssueModel: any,
  issueId: string
): Promise<boolean> => {
  try {
    const existing = await IssueModel.find({
      where: {
        id: issueId,
        ActivityFeed_SOME: {
          actionType: 'delete',
        },
      },
      selectionSet: `{
        id
      }`,
    });
    return existing.length > 0;
  } catch (error) {
    console.error('Error checking issue delete activity:', error);
    return false;
  }
};

const recordDeleteClosure = async (input: {
  issueLookup: {
    discussionId?: string;
    commentId?: string;
    eventId?: string;
  };
  actionDescription: string;
  context: any;
}) => {
  const { issueLookup, actionDescription, context } = input;
  const IssueModel = context?.ogm?.model('Issue');
  if (!IssueModel) {
    return;
  }

  const issueIds = await getIssueIdsForRelated(IssueModel, issueLookup);
  if (!issueIds.length) {
    return;
  }

  const attribution = getAttributionFromContext(context);

  for (const issueId of issueIds) {
    try {
      await IssueModel.update({
        where: { id: issueId },
        update: {
          isOpen: false,
        },
      });
    } catch (error) {
      console.error('Error closing issue after deletion:', error);
    }

    const hasDeleteActivity = await issueHasDeleteActivity(IssueModel, issueId);
    if (hasDeleteActivity) {
      continue;
    }

    await createIssueActivityFeedItems({
      IssueModel,
      issueIds: [issueId],
      actionDescription,
      actionType: 'delete',
      attribution,
    });
  }
};

const recordEditActivity = async (input: {
  issueLookup: {
    discussionId?: string;
    commentId?: string;
    eventId?: string;
  };
  actionDescription: string;
  context: any;
}) => {
  const { issueLookup, actionDescription, context } = input;
  const IssueModel = context?.ogm?.model('Issue');
  if (!IssueModel) {
    return;
  }

  const issueIds = await getIssueIdsForRelated(IssueModel, issueLookup);
  if (!issueIds.length) {
    return;
  }

  const attribution = getAttributionFromContext(context);
  await createIssueActivityFeedItems({
    IssueModel,
    issueIds,
    actionDescription,
    actionType: 'edit',
    attribution,
  });
};

const issueActivityFeedMiddleware = {
  Mutation: {
    deleteComments: async (
      resolve: Resolver,
      parent: unknown,
      args: { where?: { id?: string } },
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);
      const commentId = args?.where?.id;
      if (result?.nodesDeleted && commentId) {
        await recordDeleteClosure({
          issueLookup: { commentId },
          actionDescription: 'deleted the comment',
          context,
        });
      }
      return result;
    },
    deleteDiscussions: async (
      resolve: Resolver,
      parent: unknown,
      args: { where?: { id?: string } },
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);
      const discussionId = args?.where?.id;
      if (result?.nodesDeleted && discussionId) {
        await recordDeleteClosure({
          issueLookup: { discussionId },
          actionDescription: 'deleted the discussion',
          context,
        });
      }
      return result;
    },
    deleteEvents: async (
      resolve: Resolver,
      parent: unknown,
      args: { where?: { id?: string } },
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);
      const eventId = args?.where?.id;
      if (result?.nodesDeleted && eventId) {
        await recordDeleteClosure({
          issueLookup: { eventId },
          actionDescription: 'deleted the event',
          context,
        });
      }
      return result;
    },
    updateEvents: async (
      resolve: Resolver,
      parent: unknown,
      args: { where?: { id?: string }; update?: Record<string, any> },
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);
      const eventId = args?.where?.id;
      const hasUpdates = args?.update && Object.keys(args.update).length > 0;
      if (eventId && hasUpdates) {
        await recordEditActivity({
          issueLookup: { eventId },
          actionDescription: 'edited the event',
          context,
        });
      }
      return result;
    },
    updateEventWithChannelConnections: async (
      resolve: Resolver,
      parent: unknown,
      args: { where?: { id?: string } },
      context: any,
      info: GraphQLResolveInfo
    ) => {
      const result = await resolve(parent, args, context, info);
      const eventId = args?.where?.id;
      if (eventId) {
        await recordEditActivity({
          issueLookup: { eventId },
          actionDescription: 'edited the event',
          context,
        });
      }
      return result;
    },
  },
};

export default issueActivityFeedMiddleware;
