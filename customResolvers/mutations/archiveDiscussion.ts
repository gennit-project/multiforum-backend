import {createDiscussionModerationRepository, type DiscussionModerationRepository, type DiscussionModerationIssue} from "../../services/persistence/discussionModerationRepository.js";
import type {
  DiscussionChannelUpdateInput,
  DiscussionChannelWhere,
} from "../../ogm_types.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { getFinalCommentText } from "./shared/reportText.js";
import { formatModerationActionText } from "../../services/persistence/moderationIssueWrites.js";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { notifyArchivedContentAuthor } from "../../hooks/archivedContentNotificationHook.js";
import { logger } from "../../logger.js";

type Args = {
  discussionId: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  reportText: string;
  channelUniqueName: string;
};

type Input = {
  discussionModerationRepository?: DiscussionModerationRepository;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.discussionModerationRepository ?? createDiscussionModerationRepository(driver);
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const {
      discussionId,
      selectedForumRules,
      selectedServerRules,
      reportText,
      channelUniqueName,
    } = args;

    if (!discussionId) {
      throw new GraphQLError("Discussion ID is required");
    }

    if (!channelUniqueName) {
      throw new GraphQLError("A forum name is required.");
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
    let existingIssue: DiscussionModerationIssue | null = null;
    let existingIssueFlaggedServerRuleViolation = false;
    const discussionData = await repository.findDiscussion({
        id: { eq: discussionId },
      });

    // Check if an issue already exists for the discussion ID and channel unique name.
    const issueData = await repository.findRelatedIssues({
        channelUniqueName: { eq: channelUniqueName },
        relatedDiscussionId: { eq: discussionId },
      });

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssue = issueData[0];
      existingIssueFlaggedServerRuleViolation =
        issueData[0]?.flaggedServerRuleViolation || false;
    } else {
      // If an issue does NOT already exist, create a new issue.
      const discussionTitle = discussionData[0]?.title || "";

      const issueNumber = await getNextIssueNumber(driver, channelUniqueName);
      const title = `[Reported discussion] "${discussionTitle?.substring(0, 50) || ""}${
        discussionTitle.length > 50 ? "..." : ""
      }"`;

      try {
        const issueData = await repository.createArchiveIssue([{
          issueNumber,
          title,
          authorModName: loggedInModName,
          channelUniqueName,
          flaggedServerRuleViolation: selectedServerRules.length > 0,
          relatedDiscussionId: discussionId,
        }]);
        const issueId = issueData.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
        existingIssue = issueData.issues[0];
      } catch (error) {
        throw new GraphQLError("Error creating issue");
      }
    }

    const finalDiscussionText = getFinalCommentText({
      reportText,
      selectedForumRules,
      selectedServerRules,
    });

    try {
      // Add the activity feed item to the issue that says we archived the
      // discussion (single action closing the issue), via the owned write.
      const issueData = await repository.recordAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "archive",
            actionDescription: "Archived the discussion, closing the issue",
            text: formatModerationActionText({ text: finalDiscussionText }),
            modDisplayName: loggedInModName,
            commentChannelUniqueName: channelUniqueName,
          },
        ],
        isOpen: false, // Close the issue; archival is often the final action.
        flaggedServerRuleViolation:
          existingIssueFlaggedServerRuleViolation ||
          selectedServerRules.length > 0,
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
        actionDescription: "Archived the discussion, closing the issue",
        commentText: finalDiscussionText,
      });
    } catch (error) {
      throw new GraphQLError("Error updating issue");
    }

    try {
      // Update the discussionChannel so that archived=true and the issue is linked
      // to the discussion under RelatedIssues.
      // First we need to find the discussionChannel that matches the given discussion ID
      // and channel unique name.
      const discussionChannel = await repository.findDiscussionChannel({
          discussionId: { eq: discussionId },
          channelUniqueName: { eq: channelUniqueName },
        });
      const discussionChannelId = discussionChannel[0]?.id || null;
      if (!discussionChannelId) {
        throw new GraphQLError("Error finding discussionChannel");
      }
      const discussionChannelUpdateWhere: DiscussionChannelWhere = {
        id: { eq: discussionChannelId },
      };
      const discussionChannelUpdateInput: DiscussionChannelUpdateInput = {
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
      const discussionChannelUpdateData = await repository.setArchived(discussionChannelUpdateWhere, discussionChannelUpdateInput);
      const discussionChannelUpdateId =
        discussionChannelUpdateData.discussionChannels[0]?.id || null;
      if (!discussionChannelUpdateId) {
        throw new GraphQLError("Error updating discussionChannel");
      }

      // Notify the discussion author that their content was archived
      const discussionAuthorUsername = discussionData[0]?.Author?.username;
      const issueNumber = existingIssue?.issueNumber;

      if (discussionAuthorUsername && issueNumber) {
        const baseUrl = process.env.FRONTEND_URL || '';
        const contentUrl = `${baseUrl}/forums/${channelUniqueName}/discussions/${discussionId}`;

        await notifyArchivedContentAuthor({
          context: { driver: context.driver, notificationSnapshotRepository: context.notificationSnapshotRepository, notificationWriter: context.notificationWriter },
          contentType: 'discussion',
          authorUsername: discussionAuthorUsername,
          contentUrl,
          channelUniqueName,
          issueNumber,
          moderatorUsername: loggedInUsername,
        });
      }

      return existingIssue;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Error updating discussionChannel for archiveDiscussion:", errorMessage, error);
      throw new GraphQLError(`Failed to update discussion channel: ${errorMessage}`);
    }
  };
};

export default getResolver;
