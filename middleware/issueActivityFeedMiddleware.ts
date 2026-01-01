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

type AuthorInfo = {
  label: string | null;
  username: string | null;
};

const formatUserLabel = (input: {
  username?: string | null;
  displayName?: string | null;
}) => {
  const { username, displayName } = input;
  if (displayName && username) {
    return `${displayName} (${username})`;
  }
  return displayName || username || null;
};

const getDeleteAttribution = (input: {
  context: any;
  authorUsername: string | null;
}) => {
  const { context, authorUsername } = input;
  const username = context?.user?.username || null;
  const modProfileName =
    context?.user?.data?.ModerationProfile?.displayName || null;

  if (authorUsername && username && authorUsername === username) {
    return { username, modProfileName: null };
  }

  if (modProfileName) {
    return { username: null, modProfileName };
  }

  return { username, modProfileName: null };
};

const getCommentAuthorInfo = async (
  CommentModel: any,
  commentId: string
): Promise<AuthorInfo> => {
  const comments = await CommentModel.find({
    where: { id: commentId },
    selectionSet: `{
      id
      CommentAuthor {
        ... on User {
          username
          displayName
        }
        ... on ModerationProfile {
          displayName
        }
      }
    }`,
  });

  const comment = comments?.[0];
  const author = comment?.CommentAuthor || null;
  const username = author?.username || null;
  const displayName = author?.displayName || null;

  return {
    label: formatUserLabel({ username, displayName }),
    username,
  };
};

const getDiscussionAuthorInfo = async (
  DiscussionModel: any,
  discussionId: string
): Promise<AuthorInfo> => {
  const discussions = await DiscussionModel.find({
    where: { id: discussionId },
    selectionSet: `{
      id
      Author {
        username
        displayName
      }
    }`,
  });

  const discussion = discussions?.[0];
  const author = discussion?.Author || null;
  const username = author?.username || null;
  const displayName = author?.displayName || null;

  return {
    label: formatUserLabel({ username, displayName }),
    username,
  };
};

const getEventAuthorInfo = async (
  EventModel: any,
  eventId: string
): Promise<AuthorInfo> => {
  const events = await EventModel.find({
    where: { id: eventId },
    selectionSet: `{
      id
      Poster {
        username
        displayName
      }
    }`,
  });

  const event = events?.[0];
  const author = event?.Poster || null;
  const username = author?.username || null;
  const displayName = author?.displayName || null;

  return {
    label: formatUserLabel({ username, displayName }),
    username,
  };
};

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
  authorInfo?: AuthorInfo | null;
  context: any;
}) => {
  const { issueLookup, actionDescription, authorInfo, context } = input;
  const IssueModel = context?.ogm?.model('Issue');
  if (!IssueModel) {
    return;
  }

  const issueIds = await getIssueIdsForRelated(IssueModel, issueLookup);
  if (!issueIds.length) {
    return;
  }

  const attribution = getDeleteAttribution({
    context,
    authorUsername: authorInfo?.username || null,
  });

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
      actionDescription:
        'the issue was closed because the reported content was deleted',
      actionType: 'close',
      attribution,
    });

    const actionText = authorInfo?.label
      ? `${actionDescription} by ${authorInfo.label}`
      : actionDescription;

    await createIssueActivityFeedItems({
      IssueModel,
      issueIds: [issueId],
      actionDescription: actionText,
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
      const commentId = args?.where?.id;
      const CommentModel = context?.ogm?.model('Comment');
      const authorInfo = commentId && CommentModel
        ? await getCommentAuthorInfo(CommentModel, commentId)
        : null;
      const result = await resolve(parent, args, context, info);
      if (result?.nodesDeleted && commentId) {
        await recordDeleteClosure({
          issueLookup: { commentId },
          actionDescription: 'deleted the comment',
          authorInfo,
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
      const discussionId = args?.where?.id;
      const DiscussionModel = context?.ogm?.model('Discussion');
      const authorInfo = discussionId && DiscussionModel
        ? await getDiscussionAuthorInfo(DiscussionModel, discussionId)
        : null;
      const result = await resolve(parent, args, context, info);
      if (result?.nodesDeleted && discussionId) {
        await recordDeleteClosure({
          issueLookup: { discussionId },
          actionDescription: 'deleted the discussion',
          authorInfo,
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
      const eventId = args?.where?.id;
      const EventModel = context?.ogm?.model('Event');
      const authorInfo = eventId && EventModel
        ? await getEventAuthorInfo(EventModel, eventId)
        : null;
      const result = await resolve(parent, args, context, info);
      if (result?.nodesDeleted && eventId) {
        await recordDeleteClosure({
          issueLookup: { eventId },
          actionDescription: 'deleted the event',
          authorInfo,
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
