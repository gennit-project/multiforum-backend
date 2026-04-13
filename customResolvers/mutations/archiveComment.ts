import type {
  Issue,
  IssueModel,
  CommentModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
  CommentUpdateInput,
  CommentWhere,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { getFinalCommentText } from "./reportDiscussion.js";
import {
  getModerationActionCreateInput,
  getIssueCreateInput,
} from "./reportComment.js";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { notifyArchivedContentAuthor } from "../../hooks/archivedContentNotificationHook.js";

type Args = {
  commentId: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  reportText: string;
};

type Input = {
  Issue: IssueModel;
  Comment: CommentModel;
  driver: any;
};

type CommentAuthorForNotification =
  | {
      __typename: "User";
      username?: string | null;
    }
  | {
      __typename: "ModerationProfile";
      User?: { username?: string | null } | null;
    }
  | null
  | undefined;

type ArchivedCommentContext = {
  DiscussionChannel?: {
    discussionId?: string | null;
  } | null;
  Event?: {
    id?: string | null;
  } | null;
  ParentComment?: {
    DiscussionChannel?: {
      discussionId?: string | null;
    } | null;
    Event?: {
      id?: string | null;
    } | null;
  } | null;
};

const getCommentAuthorUsername = (
  author: CommentAuthorForNotification
): string | null => {
  if (!author) {
    return null;
  }

  if (author.__typename === "User") {
    return author.username || null;
  }

  return author.User?.username || null;
};

const buildArchivedCommentUrl = ({
  baseUrl,
  channelUniqueName,
  commentId,
  comment,
}: {
  baseUrl: string;
  channelUniqueName: string;
  commentId: string;
  comment: ArchivedCommentContext;
}): string => {
  const discussionId =
    comment.DiscussionChannel?.discussionId ||
    comment.ParentComment?.DiscussionChannel?.discussionId;
  if (discussionId) {
    return `${baseUrl}/forums/${channelUniqueName}/discussions/${discussionId}/comments/${commentId}`;
  }

  const eventId = comment.Event?.id || comment.ParentComment?.Event?.id;
  if (eventId) {
    return `${baseUrl}/forums/${channelUniqueName}/events/${eventId}/comments/${commentId}`;
  }

  return "";
};

const getResolver = (input: Input) => {
  const { Issue, Comment, driver } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { commentId, selectedForumRules, selectedServerRules, reportText } =
      args;

    if (!commentId) {
      throw new GraphQLError("Comment ID is required");
    }

    const atLeastOneViolation =
      selectedForumRules?.length > 0 || selectedServerRules?.length > 0;

    if (!atLeastOneViolation) {
      throw new GraphQLError("At least one rule must be selected");
    }

    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new GraphQLError("User must be logged in");
    }

    const loggedInModName = context.user.data.ModerationProfile.displayName;
    if (!loggedInModName) {
      throw new GraphQLError(`User ${loggedInUsername} is not a moderator`);
    }

    let existingIssueId = "";
    let existingIssue: Issue | null = null;
    let existingIssueFlaggedServerRuleViolation = false;
    const commentData = await Comment.find({
      where: {
        id: commentId,
      },
      selectionSet: `{
            id
            text
            CommentAuthor {
              __typename
              ... on User {
                username
              }
              ... on ModerationProfile {
                User {
                  username
                }
              }
            }
            Channel {
              uniqueName
            }
            DiscussionChannel {
              discussionId
              channelUniqueName
            }
            Event {
              id
              EventChannels {
                channelUniqueName
              }
            }
            ParentComment {
              Channel {
                uniqueName
              }
              DiscussionChannel {
                discussionId
                channelUniqueName
              }
              Event {
                id
                EventChannels {
                  channelUniqueName
                }
              }
            }
        }`,
    });
    const channelUniqueName =
      commentData[0]?.Channel?.uniqueName ||
      commentData[0]?.DiscussionChannel?.channelUniqueName ||
      commentData[0]?.Event?.EventChannels?.[0]?.channelUniqueName ||
      commentData[0]?.ParentComment?.Channel?.uniqueName ||
      commentData[0]?.ParentComment?.DiscussionChannel?.channelUniqueName ||
      commentData[0]?.ParentComment?.Event?.EventChannels?.[0]?.channelUniqueName ||
      "";
    if (!channelUniqueName) {
      throw new GraphQLError(
        "Could not find the forum name attached to the comment."
      );
    }

    // Check if an issue already exists for the comment ID and channel unique name.
    const issueData = await Issue.find({
      where: {
        channelUniqueName: channelUniqueName,
        relatedCommentId: commentId,
      },
      selectionSet: `{
            id
            issueNumber
            flaggedServerRuleViolation
        }`,
    });

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssue = issueData[0];
      existingIssueFlaggedServerRuleViolation =
        issueData[0]?.flaggedServerRuleViolation || false;
    }

    const finalCommentText = getFinalCommentText({
      reportText,
      selectedForumRules,
      selectedServerRules,
    });

    if (!existingIssueId) {
      // If an issue does NOT already exist, create a new issue.
      try {
        const commentText = commentData[0]?.text || "";

        const issueNumber = await getNextIssueNumber(driver, channelUniqueName);
        const issueCreateInput: IssueCreateInput = getIssueCreateInput({
          contextText: commentText,
          selectedForumRules,
          selectedServerRules,
          loggedInModName,
          channelUniqueName,
          reportedContentType: "comment",
          relatedCommentId: commentId,
          issueNumber,
        });
        const issueData = await Issue.create({
          input: [issueCreateInput],
          selectionSet: `{
            issues {
              id
              issueNumber
              flaggedServerRuleViolation
            }
          }`,
        });
        const issueId = issueData.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
        existingIssue = issueData.issues[0];
      } catch (error) {
        console.log("Error creating issue", error);
        return false;
      }
    }
    
    const archiveCommentModActionCreateInput: ModerationActionCreateInput =
      getModerationActionCreateInput({
        text: finalCommentText,
        loggedInModName,
        channelUniqueName,
        actionType: "archive",
        actionDescription: "Archived the comment",
        issueId: existingIssueId,
        suspendUntil: undefined,
        suspendIndefinitely: false,
      });

      const closeIssueModActionCreateInput: ModerationActionCreateInput =
      getModerationActionCreateInput({
        text: finalCommentText,
        loggedInModName,
        channelUniqueName,
        actionType: "close",
        actionDescription: "Closed the issue",
        issueId: existingIssueId,
        suspendUntil: undefined,
        suspendIndefinitely: false,
      });
      console.log('mod action create input ',JSON.stringify(archiveCommentModActionCreateInput))

    // Update the issue with the new moderation action.
    const issueUpdateWhere: IssueWhere = {
      id: existingIssueId,
    };
    const archiveCommentUpdateIssueInput: IssueUpdateInput = {
      ActivityFeed: [
        {
          create: [
            {
              node: archiveCommentModActionCreateInput,
            },
          ],
        },
      ],
      flaggedServerRuleViolation:
        existingIssueFlaggedServerRuleViolation ||
        selectedServerRules.length > 0,
    };

    const closeIssueUpdateIssueInput: IssueUpdateInput = {
      isOpen: false, // Close the issue; un-archival is often the final action.
      ActivityFeed: [
        {
          create: [
            {
              node: closeIssueModActionCreateInput,
            },
          ],
        },
      ],
    };

    try {
      await Issue.update({
        where: issueUpdateWhere,
        update: archiveCommentUpdateIssueInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`,
      });
      const issueData = await Issue.update({
        where: issueUpdateWhere,
        update: closeIssueUpdateIssueInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`,
      });
      const issueId = issueData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      existingIssue = issueData.issues[0];
      await notifyIssueSubscribers({
        IssueModel: Issue,
        driver: context.driver,
        issueId,
        actorUsername: loggedInUsername,
        actionType: "archive",
        actionDescription: "Archived the comment",
        commentText: finalCommentText,
      });
      
    } catch (error) {
      throw new GraphQLError("Error updating issue");
    }

    try {
      // Update the comment so that archived=true and the issue is linked
      // to the comment under RelatedIssues.
      const commentUpdateWhere: CommentWhere = {
        id: commentId,
      };
      const commentUpdateInput: CommentUpdateInput = {
        archived: true,
        RelatedIssues: [
          {
            connect: [
              {
                where: {
                  node: {
                    id: existingIssueId,
                  },
                },
              },
            ],
          },
        ],
      };
      const commentUpdateData = await Comment.update({
        where: commentUpdateWhere,
        update: commentUpdateInput,
      });
      const commentUpdateId = commentUpdateData.comments[0]?.id || null;
      if (!commentUpdateId) {
        throw new GraphQLError("Error updating comment");
      }

      // Notify the comment author that their content was archived
      const commentAuthorUsername = getCommentAuthorUsername(
        commentData[0]?.CommentAuthor as CommentAuthorForNotification
      );
      const issueNumber = existingIssue?.issueNumber;

      if (commentAuthorUsername && issueNumber) {
        const contentUrl = buildArchivedCommentUrl({
          baseUrl: process.env.FRONTEND_URL || "",
          channelUniqueName,
          commentId,
          comment: commentData[0] as ArchivedCommentContext,
        });

        if (contentUrl) {
          await notifyArchivedContentAuthor({
            context: { ogm: context.ogm, driver: context.driver },
            contentType: 'comment',
            authorUsername: commentAuthorUsername,
            contentUrl,
            channelUniqueName,
            issueNumber,
            moderatorUsername: loggedInUsername,
          });
        }
      }

      return existingIssue;
    } catch (error) {
      throw new GraphQLError("Error updating comment");
    }
  };
};

export default getResolver;
