import { createIssueLockRepository, type IssueLockRepository } from "../../services/persistence/issueLockRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { logger } from "../../logger.js";

type Args = {
  issueId: string;
  reason: string;
};

type Input = {
  issueLockRepository?: IssueLockRepository;
  notifySubscribers?: typeof notifyIssueSubscribers;
};

const getResolver = (input: Input = {}) => {
  const { issueLockRepository, notifySubscribers = notifyIssueSubscribers } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { issueId, reason } = args;

    if (!issueId) {
      throw new GraphQLError("Issue ID is required");
    }

    if (!reason || reason.trim() === "") {
      throw new GraphQLError("A reason is required to lock an issue");
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

    if (existingIssue.locked) {
      throw new GraphQLError("Issue is already locked");
    }

    // Lock the issue via the owned write: the moderation action + embedded
    // moderator comment, the lock scalars, and the LockedBy (LOCKED_ISSUE) edge.
    try {
      const updateResult = await repository.lockIssue({
        issueId,
        modDisplayName: loggedInModName,
        lockedAt: new Date().toISOString(),
        lockReason: reason,
        action: {
          actionType: "lock",
          actionDescription: "Locked the issue",
          text: `**Reason for locking:** ${reason}`,
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
        actionType: "lock",
        actionDescription: "Locked the issue",
        commentText: reason,
      });

      logger.info(`✅ Issue ${existingIssue.issueNumber} locked by ${loggedInModName}`);
      return updatedIssue;
    } catch (error) {
      logger.error("Error locking issue:", error);
      throw new GraphQLError("Error locking issue");
    }
  };
};

export default getResolver;
