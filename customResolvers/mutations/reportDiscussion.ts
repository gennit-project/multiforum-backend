import { createDiscussionReportRepository, type DiscussionReportRepository } from "../../services/persistence/discussionReportRepository.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { formatModerationActionText } from "../../services/persistence/moderationIssueWrites.js";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";
import { getFinalCommentText } from "./shared/reportText.js";
import { logger } from "../../logger.js";

type Args = {
  discussionId: string;
  reportText: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  channelUniqueName: string;
};

type Input = {
  discussionReportRepository?: DiscussionReportRepository;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.discussionReportRepository ?? createDiscussionReportRepository(driver);
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const {
      discussionId,
      reportText,
      selectedForumRules,
      selectedServerRules,
      channelUniqueName,
    } = args;

    if (!discussionId) {
      throw new GraphQLError("Discussion ID is required");
    }

    if (!channelUniqueName) {
      throw new GraphQLError("Channel unique name is required");
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
    let existingIssueFlaggedServerRuleViolation = false;

    // Check if an issue already exists for the discussion ID and channel unique name.
    const issueData = await repository.findExisting(channelUniqueName, discussionId);

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssueFlaggedServerRuleViolation =
        issueData[0]?.flaggedServerRuleViolation || false;
    }

    const finalCommentText = getFinalCommentText({
      reportText,
      selectedForumRules,
      selectedServerRules,
    });

    // If an issue does NOT already exist, create a new issue.
    if (!existingIssueId) {
      const discussionData = await repository.findDiscussion(discussionId);
      const contextText = discussionData[0]?.title || "";

      const issueNumber = await getNextIssueNumber(driver, channelUniqueName);
      const title = `[Reported discussion] "${contextText?.substring(0, 50) || ""}${
        contextText.length > 50 ? "..." : ""
      }"`;
      // Pre-create channel existence check: a lookup failure aborts before any
      // write. The HAS_ISSUE connect itself is best-effort in the owned write, so
      // a missing channel simply yields a channel-scoped scalar with no edge.
      await repository.findChannel(channelUniqueName);
      try {
        const issueData = await repository.createIssue({
          issueNumber,
          title,
          authorModName: loggedInModName,
          channelUniqueName,
          flaggedServerRuleViolation: selectedServerRules.length > 0,
          relatedDiscussionId: discussionId,
        });
        const issueId = issueData.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
      } catch (error) {
        logger.error("Error creating issue:", { error });
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    // Append the report moderation action (with its embedded moderator comment)
    // via the owned moderation write.
    try {
      const issueData = await repository.appendReport({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "report",
            actionDescription: "Reported the discussion",
            text: formatModerationActionText({ text: finalCommentText }),
            modDisplayName: loggedInModName,
            commentChannelUniqueName: channelUniqueName,
          },
        ],
        isOpen: true, // Reopen the issue if it was closed
        flaggedServerRuleViolation:
          existingIssueFlaggedServerRuleViolation ||
          selectedServerRules.length > 0,
      });
      const issueId = issueData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      return issueData.issues[0];
    } catch (error) {
      throw new GraphQLError("Error updating issue");
    }
  };
};

export default getResolver;
