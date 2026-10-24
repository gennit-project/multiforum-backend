import { createCommentModerationRepository, type CommentModerationRepository } from "../../services/persistence/commentModerationRepository.js";
import type {
  Issue,
  CommentUpdateInput,
  CommentWhere,
} from "../../ogm_types.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { getFinalCommentText } from "./shared/reportText.js";
import { getRelatedIssueAccountFields } from "./reportComment.js";
import { formatModerationActionText } from "../../services/persistence/moderationIssueWrites.js";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { notifyArchivedContentAuthor } from "../../hooks/archivedContentNotificationHook.js";
import { logger } from "../../logger.js";

type Args = {
  commentId: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  reportText: string;
};

type Input = {
  repository?: CommentModerationRepository;
  driver: Driver;
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
  const { driver } = input;
  const repository = input.repository ?? createCommentModerationRepository(driver);
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
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
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new GraphQLError("User must be logged in");
    }

    const loggedInModName = context.user.data?.ModerationProfile?.displayName;
    if (!loggedInModName) {
      throw new GraphQLError(`User ${loggedInUsername} is not a moderator`);
    }

    let existingIssueId = "";
    let existingIssue: Issue | null = null;
    let existingIssueFlaggedServerRuleViolation = false;
    const commentData = await repository.findArchiveTarget(commentId);
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
    const issueData = await repository.findIssue(channelUniqueName, commentId);

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

    // Extract related account fields from the comment author
    const { relatedUsername, relatedModProfileName } = getRelatedIssueAccountFields(
      commentData[0]?.CommentAuthor
    );

    if (!existingIssueId) {
      // If an issue does NOT already exist, create a new issue.
      try {
        const commentText = commentData[0]?.text || "";

        const issueNumber = await getNextIssueNumber(driver, channelUniqueName);
        const truncatedContextText = commentText?.substring(0, 50) || "";
        const title = `[Reported comment] "${truncatedContextText}${
          commentText.length > 50 ? "..." : ""
        }"`;
        const issueData = await repository.createArchiveIssue({
          issueNumber,
          title,
          authorModName: loggedInModName,
          channelUniqueName,
          flaggedServerRuleViolation: selectedServerRules.length > 0,
          relatedCommentId: commentId,
          relatedUsername,
          relatedModProfileName,
        });
        const issueId = issueData.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
        existingIssue = issueData.issues[0];
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error creating issue for archiveComment:", errorMessage, error);
        throw new GraphQLError(`Failed to create issue for archived comment: ${errorMessage}`);
      }
    }
    
    // Record the archive action then the close action on the issue's activity
    // feed via the owned moderation write (two appends, same as before).
    const actionText = formatModerationActionText({ text: finalCommentText });
    try {
      await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "archive",
            actionDescription: "Archived the comment",
            text: actionText,
            modDisplayName: loggedInModName,
            commentChannelUniqueName: channelUniqueName,
          },
        ],
        flaggedServerRuleViolation:
          existingIssueFlaggedServerRuleViolation ||
          selectedServerRules.length > 0,
      });
      const issueData = await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "close",
            actionDescription: "Closed the issue",
            text: actionText,
            modDisplayName: loggedInModName,
            commentChannelUniqueName: channelUniqueName,
          },
        ],
        isOpen: false, // Close the issue; un-archival is often the final action.
      });
      const issueId = issueData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      existingIssue = issueData.issues[0];
      await notifyIssueSubscribers({
        notificationSnapshotRepository: context.notificationSnapshotRepository,
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
        id: { eq: commentId },
      };
      const commentUpdateInput: CommentUpdateInput = {
        archived: { set: true },
        RelatedIssues: [
          {
            connect: [
              {
                where: {
                  node: {
                    id: { eq: existingIssueId },
                  },
                },
              },
            ],
          },
        ],
      };
      const commentUpdateData = await repository.setArchived(commentUpdateWhere, commentUpdateInput);
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
            context: { driver: context.driver, notificationSnapshotRepository: context.notificationSnapshotRepository, notificationWriter: context.notificationWriter },
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
