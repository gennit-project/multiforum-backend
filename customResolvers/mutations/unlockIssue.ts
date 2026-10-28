import { createIssueLockRepository, type IssueLockRepository } from "../../services/persistence/issueLockRepository.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { logger } from "../../logger.js";

type Args = {
  issueId: string;
  reason?: string;
};

type Input = {
  issueLockRepository?: IssueLockRepository;
  notifySubscribers?: typeof notifyIssueSubscribers;
};

const getResolver = (input: Input = {}) => {
  const { issueLockRepository, notifySubscribers = notifyIssueSubscribers } = input;
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const { issueId, reason } = args;

    if (!issueId) {
      throw new GraphQLError("Issue ID is required");
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

    // Find the issue and check if it exists
    const repository = issueLockRepository ?? createIssueLockRepository(context.driver);
    const issueData = await repository.findLockState(issueId);

    if (issueData.length === 0) {
      throw new GraphQLError("Issue not found");
    }

    const existingIssue = issueData[0];

    if (!existingIssue.locked) {
      throw new GraphQLError("Issue is not locked");
    }

    // Create the moderation action for the activity feed
    const actionText = reason
      ? `**Reason for unlocking:** ${reason}`
      : "Issue unlocked";

    // Unlock the issue via the owned write: the moderation action + embedded
    // moderator comment, clear the lock scalars, and drop the LockedBy
    // (LOCKED_ISSUE) edge.
    try {
      const updateResult = await repository.unlockIssue({
        issueId,
        modDisplayName: loggedInModName,
        lockedAt: null,
        lockReason: null,
        action: {
          actionType: "unlock",
          actionDescription: "Unlocked the issue",
          text: actionText,
          modDisplayName: loggedInModName,
          commentChannelUniqueName: null,
        },
      });

      const updatedIssue = updateResult.issues[0];
      if (!updatedIssue) {
        throw new GraphQLError("Error updating issue");
      }

      await notifySubscribers({
        notificationSnapshotRepository: context.notificationSnapshotRepository,
        driver: context.driver,
        issueId,
        actorUsername: loggedInUsername,
        actionType: "unlock",
        actionDescription: "Unlocked the issue",
        commentText: reason || null,
      });

      logger.info(`✅ Issue ${existingIssue.issueNumber} unlocked by ${loggedInModName}`);
      return updatedIssue;
    } catch (error) {
      logger.error("Error unlocking issue:", error);
      throw new GraphQLError("Error unlocking issue");
    }
  };
};

export default getResolver;
