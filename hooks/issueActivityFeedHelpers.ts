type IssueModel = any;

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
  IssueModel: IssueModel;
  issueIds: string[];
  actionDescription: string;
  actionType?: string;
  attribution: ActivityAttribution;
  revisionId?: string;
  commentId?: string | null;
};

export const getAttributionFromContext = (context: any): ActivityAttribution => {
  return {
    username: context?.user?.username || null,
    modProfileName: context?.user?.data?.ModerationProfile?.displayName || null,
  };
};

export const getIssueIdsForRelated = async (
  IssueModel: IssueModel,
  related: RelatedIssueLookup
): Promise<string[]> => {
  try {
    const where: Record<string, string> = {};
    if (related.discussionId) {
      where.relatedDiscussionId = related.discussionId;
    }
    if (related.commentId) {
      where.relatedCommentId = related.commentId;
    }
    if (related.eventId) {
      where.relatedEventId = related.eventId;
    }

    if (!Object.keys(where).length) {
      return [];
    }

    const issues = await IssueModel.find({
      where,
      selectionSet: `{
        id
      }`,
    });

    return issues.map((issue: { id?: string }) => issue.id).filter(Boolean);
  } catch (error) {
    console.error('Error fetching related issues:', error);
    return [];
  }
};

export const createIssueActivityFeedItems = async (
  input: IssueActivityInput
) => {
  const {
    IssueModel,
    issueIds,
    actionDescription,
    actionType,
    attribution,
    revisionId,
    commentId,
  } = input;

  if (!issueIds.length) {
    return;
  }

  const activityNode: Record<string, any> = {
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
      await IssueModel.update({
        where: { id: issueId },
        update: {
          ActivityFeed: [
            {
              create: [
                {
                  node: activityNode,
                },
              ],
            },
          ],
        },
      });
    } catch (error) {
      console.error('Error creating issue activity feed item:', error);
    }
  }
};
