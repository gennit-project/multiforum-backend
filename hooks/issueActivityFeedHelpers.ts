import type { IssueActivityRepository, ModerationActivityNode } from "../services/persistence/issueActivityRepository.js";
import type { Driver } from "neo4j-driver";
import type { IssueWhere } from "../ogm_types.js";
import type { GraphQLContext } from "../types/context.js";

type ActivityAttribution = {
  username?: string | null;
  modProfileName?: string | null;
};

type RelatedIssueLookup = {
  discussionId?: string | null;
  commentId?: string | null;
  eventId?: string | null;
};

type IssueActivityInput = {
  issueActivityRepository: IssueActivityRepository;
  driver?: Driver;
  issueIds: string[];
  actionDescription: string;
  actionType?: string;
  attribution: ActivityAttribution;
  actorUsername?: string | null;
  revisionId?: string;
  commentId?: string | null;
  commentText?: string | null;
};

import { notifyIssueSubscribers } from "../services/issueNotifications.js";
import { logger } from "../logger.js";

export const getAttributionFromContext = (context: GraphQLContext): ActivityAttribution => {
  return {
    username: context?.user?.username || null,
    modProfileName: context?.user?.data?.ModerationProfile?.displayName || null,
  };
};

export const getIssueIdsForRelated = async (
  issueActivityRepository: IssueActivityRepository,
  related: RelatedIssueLookup
): Promise<string[]> => {
  try {
    const where: IssueWhere = {};
    if (related.discussionId) {
      where.relatedDiscussionId = { eq: related.discussionId };
    }
    if (related.commentId) {
      where.relatedCommentId = { eq: related.commentId };
    }
    if (related.eventId) {
      where.relatedEventId = { eq: related.eventId };
    }

    if (!Object.keys(where).length) {
      return [];
    }

    const issues = await issueActivityRepository.findRelatedIssueIds(where);

    return issues
      .map((issue: { id?: string }) => issue.id)
      .filter((id): id is string => Boolean(id));
  } catch (error) {
    logger.error('Error fetching related issues:', error);
    return [];
  }
};

export const createIssueActivityFeedItems = async (
  input: IssueActivityInput
) => {
  const {
    issueActivityRepository,
    driver,
    issueIds,
    actionDescription,
    actionType,
    attribution,
    actorUsername,
    revisionId,
    commentId,
    commentText,
  } = input;

  if (!issueIds.length) {
    return;
  }

  const activityNode: ModerationActivityNode = {
    actionDescription,
    actionType,
  };

  if (attribution.modProfileName) {
    activityNode.ModerationProfile = {
      connect: {
        where: {
          node: {
            displayName: attribution.modProfileName,
          },
        },
      },
    };
  } else if (attribution.username) {
    activityNode.User = {
      connect: {
        where: {
          node: {
            username: attribution.username,
          },
        },
      },
    };
  } else {
    return;
  }

  if (revisionId) {
    activityNode.Revision = {
      connect: {
        where: {
          node: {
            id: revisionId,
          },
        },
      },
    };
  }

  if (commentId) {
    activityNode.Comment = {
      connect: {
        where: {
          node: {
            id: commentId,
          },
        },
      },
    };
  }

  for (const issueId of issueIds) {
    try {
      await issueActivityRepository.appendActivity(issueId, activityNode);

      if (driver) {
        await notifyIssueSubscribers({
          driver,
          issueId,
          actorUsername: actorUsername || attribution.username || null,
          actionType,
          actionDescription,
          commentText,
        });
      }
    } catch (error) {
      logger.error('Error creating issue activity feed item:', error);
    }
  }
};
