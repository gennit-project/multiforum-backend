import { createIssueActivityMiddlewareRepository, type IssueActivityMiddlewareRepository } from "../services/persistence/issueActivityMiddlewareRepository.js";
import { createIssueActivityRepository } from "../services/persistence/issueActivityRepository.js";
import { GraphQLResolveInfo } from 'graphql';
import type { GraphQLContext } from '../types/context.js';
import { logger } from "../logger.js";
import type {
  EventUpdateInput,
} from '../ogm_types.js';
import {
  createIssueActivityFeedItems,
  getAttributionFromContext,
  getIssueIdsForRelated,
} from '../hooks/issueActivityFeedHelpers.js';

type Resolver = (
  parent: unknown,
  args: unknown,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<{ nodesDeleted?: number } | undefined>;

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
  context: GraphQLContext;
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
  repository: IssueActivityMiddlewareRepository,
  commentId: string
): Promise<AuthorInfo> => {
  const comments = await repository.findCommentAuthor(commentId);

  const comment = comments?.[0];
  const author = (comment?.CommentAuthor || null) as {
    username?: string | null;
    displayName?: string | null;
  } | null;
  const username = author?.username || null;
  const displayName = author?.displayName || null;

  return {
    label: formatUserLabel({ username, displayName }),
    username,
  };
};

const getDiscussionAuthorInfo = async (
  repository: IssueActivityMiddlewareRepository,
  discussionId: string
): Promise<AuthorInfo> => {
  const discussions = await repository.findDiscussionAuthor(discussionId);

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
  repository: IssueActivityMiddlewareRepository,
  eventId: string
): Promise<AuthorInfo> => {
  const events = await repository.findEventAuthor(eventId);

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
  repository: IssueActivityMiddlewareRepository,
  issueId: string
): Promise<boolean> => {
  try {
    const existing = await repository.findDeleteActivities(issueId);
    return existing.length > 0;
  } catch (error) {
    logger.error('Error checking issue delete activity:', error);
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
  context: GraphQLContext;
}) => {
  const { issueLookup, actionDescription, authorInfo, context } = input;
  const IssueModel = context?.ogm?.model('Issue');
  if (!IssueModel) {
    return;
  }

  const issueIds = await getIssueIdsForRelated(context.issueActivityRepository ?? createIssueActivityRepository(context.driver), issueLookup);
  if (!issueIds.length) {
    return;
  }

  const attribution = getDeleteAttribution({
    context,
    authorUsername: authorInfo?.username || null,
  });

  for (const issueId of issueIds) {
    try {
      await (context.issueActivityMiddlewareRepository ?? createIssueActivityMiddlewareRepository(context.driver)).closeDeletedIssue(issueId);
    } catch (error) {
      logger.error('Error closing issue after deletion:', error);
    }

    const hasDeleteActivity = await issueHasDeleteActivity(context.issueActivityMiddlewareRepository ?? createIssueActivityMiddlewareRepository(context.driver), issueId);
    if (hasDeleteActivity) {
      continue;
    }

    await createIssueActivityFeedItems({
      issueActivityRepository: context.issueActivityRepository ?? createIssueActivityRepository(context.driver),
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
      issueActivityRepository: context.issueActivityRepository ?? createIssueActivityRepository(context.driver),
      driver: context?.driver,
      issueIds: [issueId],
      actionDescription: actionText,
      actionType: 'delete',
      attribution,
      actorUsername: context?.user?.username || null,
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
  context: GraphQLContext;
}) => {
  const { issueLookup, actionDescription, context } = input;
  const IssueModel = context?.ogm?.model('Issue');
  if (!IssueModel) {
    return;
  }

  const issueIds = await getIssueIdsForRelated(context.issueActivityRepository ?? createIssueActivityRepository(context.driver), issueLookup);
  if (!issueIds.length) {
    return;
  }

  const attribution = getAttributionFromContext(context);
  await createIssueActivityFeedItems({
      issueActivityRepository: context.issueActivityRepository ?? createIssueActivityRepository(context.driver),
      driver: context?.driver,
      issueIds,
      actionDescription,
      actionType: 'edit',
      attribution,
      actorUsername: context?.user?.username || null,
    });
  };

const issueActivityFeedMiddleware = {
  Mutation: {
    deleteComments: async (
      resolve: Resolver,
      parent: unknown,
      args: { where?: { id?: string } },
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const commentId = args?.where?.id;
      const CommentModel = context?.ogm?.model('Comment');
      const authorInfo = commentId && CommentModel
        ? await getCommentAuthorInfo(context.issueActivityMiddlewareRepository ?? createIssueActivityMiddlewareRepository(context.driver), commentId)
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
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const discussionId = args?.where?.id;
      const DiscussionModel = context?.ogm?.model('Discussion');
      const authorInfo = discussionId && DiscussionModel
        ? await getDiscussionAuthorInfo(context.issueActivityMiddlewareRepository ?? createIssueActivityMiddlewareRepository(context.driver), discussionId)
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
      context: GraphQLContext,
      info: GraphQLResolveInfo
    ) => {
      const eventId = args?.where?.id;
      const EventModel = context?.ogm?.model('Event');
      const authorInfo = eventId && EventModel
        ? await getEventAuthorInfo(context.issueActivityMiddlewareRepository ?? createIssueActivityMiddlewareRepository(context.driver), eventId)
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
      args: { where?: { id?: string }; update?: EventUpdateInput },
      context: GraphQLContext,
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
      context: GraphQLContext,
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
