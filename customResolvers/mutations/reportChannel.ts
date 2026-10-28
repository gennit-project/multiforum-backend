import { createChannelReportRepository, type ChannelReportRepository } from "../../services/persistence/channelReportRepository.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";
import { logger } from "../../logger.js";

type Args = {
  channelUniqueName: string;
  reportText: string;
  selectedServerRules: string[];
};

type Input = {
  channelReportRepository?: ChannelReportRepository;
  driver: Driver;
};

const getFinalCommentText = (input: {
  selectedServerRules: string[];
  reportText: string;
}) => {
  const { selectedServerRules, reportText } = input;
  return `
${
  selectedServerRules.length > 0
    ? `Server rule violations: ${selectedServerRules.join(", ")}
`
    : ""
}
${
  reportText
    ? `${reportText}
`
    : ""
}
`;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.channelReportRepository ?? createChannelReportRepository(driver);
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName, reportText, selectedServerRules } = args;

    if (!channelUniqueName) {
      throw new GraphQLError("Channel unique name is required");
    }

    if (!selectedServerRules || selectedServerRules.length === 0) {
      throw new GraphQLError("At least one server rule must be selected");
    }

    // Get logged-in user data
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

    // Verify the channel exists
    const channelData = await repository.findChannel(channelUniqueName);

    if (channelData.length === 0) {
      throw new GraphQLError("Channel not found");
    }

    const channel = channelData[0];
    const channelDisplayName = channel.displayName || channelUniqueName;

    let existingIssueId = "";
    let existingIssueFlaggedServerRuleViolation = false;

    // Check if an issue already exists for this channel (server-scoped, relatedChannelUniqueName matches)
    const issueData = await repository.findExisting(channelUniqueName);

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssueFlaggedServerRuleViolation =
        issueData[0]?.flaggedServerRuleViolation || false;
    }

    const finalCommentText = getFinalCommentText({
      reportText,
      selectedServerRules,
    });

    // If an issue does NOT already exist, create a new issue.
    if (!existingIssueId) {
      const issueNumber = await getNextServerIssueNumber(driver);

      try {
        const createResult = await repository.createIssue({
          issueNumber,
          title: `[Reported channel] ${channelDisplayName}`,
          authorModName: loggedInModName,
          channelUniqueName: null, // Server-scoped issue (no HAS_ISSUE edge)
          flaggedServerRuleViolation: true, // Channel reports always flag server rule violation
          relatedChannelUniqueName: channelUniqueName, // The channel being reported → TARGETS_CHANNEL
        });
        const issueId = createResult.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
      } catch (error) {
        logger.error("Error creating channel report issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    // Append the report moderation action (with its embedded moderator comment)
    // via the owned moderation write. Server-scoped: the comment has no Channel
    // connect, and the comment text is stored verbatim (no newline wrapping).
    try {
      const updateResult = await repository.appendReport({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "report",
            actionDescription: "Reported the channel",
            text: finalCommentText,
            modDisplayName: loggedInModName,
          },
        ],
        isOpen: true, // Reopen the issue if it was closed
        flaggedServerRuleViolation: true, // Channel reports always flag server rule violation
      });
      const issueId = updateResult.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      return updateResult.issues[0];
    } catch (error) {
      logger.error("Error updating channel report issue:", error);
      throw new GraphQLError("Error updating issue");
    }
  };
};

export default getResolver;
