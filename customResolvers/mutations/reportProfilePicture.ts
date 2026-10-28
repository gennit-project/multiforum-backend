import { createProfilePictureReportRepository, type ProfilePictureReportRepository } from "../../services/persistence/profilePictureReportRepository.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";
import { logger } from "../../logger.js";

type Args = {
  username: string;
  reportText: string;
  selectedServerRules: string[];
};

type Input = {
  profilePictureReportRepository?: ProfilePictureReportRepository;
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
  const repository = input.profilePictureReportRepository ?? createProfilePictureReportRepository(driver);
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const { username, reportText, selectedServerRules } = args;

    if (!username) {
      throw new GraphQLError("Username is required");
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

    // Verify the user exists and has a profile picture
    const userData = await repository.findReportedProfile(username);

    if (userData.length === 0) {
      throw new GraphQLError("User not found");
    }

    const targetUser = userData[0];
    if (!targetUser.profilePicURL) {
      throw new GraphQLError("User does not have a profile picture");
    }

    const displayLabel = targetUser.displayName || username;

    let existingIssueId = "";
    let existingIssueFlaggedServerRuleViolation = false;

    // Check if an issue already exists for this user's profile picture (server-scoped)
    const existingIssueData = await repository.findPriorProfileReport(username);

    if (existingIssueData.length > 0) {
      existingIssueId = existingIssueData[0]?.id || "";
      existingIssueFlaggedServerRuleViolation =
        existingIssueData[0]?.flaggedServerRuleViolation || false;
    }

    const finalCommentText = getFinalCommentText({
      reportText,
      selectedServerRules,
    });

    // If an issue does NOT already exist, create a new issue.
    if (!existingIssueId) {
      const issueNumber = await getNextServerIssueNumber(driver);

      try {
        const createResult = await repository.createProfileReportIssue({
          issueNumber,
          title: `[Reported profile picture] ${displayLabel}`,
          authorModName: loggedInModName,
          channelUniqueName: null, // Server-scoped issue (no HAS_ISSUE edge)
          flaggedServerRuleViolation: true, // Profile picture reports always flag server rule violation
          relatedProfilePicUserId: username, // → TARGETS_PROFILE_PICTURE_USER
          relatedUsername: username, // → TARGETS_USER
        });
        const issueId = createResult.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
      } catch (error) {
        logger.error("Error creating profile picture report issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    // Append the report moderation action (with its embedded moderator comment)
    // via the owned moderation write. Server-scoped: the comment has no Channel
    // connect, and the comment text is stored verbatim (no newline wrapping).
    try {
      const updateResult = await repository.appendProfileReport({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "report",
            actionDescription: "Reported the profile picture",
            text: finalCommentText,
            modDisplayName: loggedInModName,
          },
        ],
        isOpen: true, // Reopen the issue if it was closed
        flaggedServerRuleViolation: true, // Profile picture reports always flag server rule violation
      });
      const issueId = updateResult.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      return updateResult.issues[0];
    } catch (error) {
      logger.error("Error updating profile picture report issue:", error);
      throw new GraphQLError("Error updating issue");
    }
  };
};

export default getResolver;
