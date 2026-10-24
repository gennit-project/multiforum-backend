import { createChannelModerationRepository, type ChannelModerationRepository } from "../../services/persistence/channelModerationRepository.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";
import { logger } from "../../logger.js";

type Args = {
  channelUniqueName: string;
  reason: string;
  issueId?: string;
};

type Input = {
  channelModerationRepository?: ChannelModerationRepository;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.channelModerationRepository ?? createChannelModerationRepository(driver);
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName, reason, issueId } = args;

    if (!channelUniqueName) {
      throw new GraphQLError("Channel unique name is required");
    }

    if (!reason || reason.trim() === "") {
      throw new GraphQLError("A reason is required to lock a channel");
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

    // Find the channel and check if it exists
    const channelData = await repository.findChannel(channelUniqueName);

    if (channelData.length === 0) {
      throw new GraphQLError("Channel not found");
    }

    const existingChannel = channelData[0];

    if (existingChannel.locked) {
      throw new GraphQLError("Channel is already locked");
    }

    const channelDisplayName =
      existingChannel.displayName || channelUniqueName;

    // Handle issue creation or linking
    let finalIssueId = issueId || "";

    if (!finalIssueId) {
      // Check if there's an existing open issue for this channel
      const existingIssues = await repository.findOpenIssues(channelUniqueName);

      if (existingIssues.length > 0) {
        finalIssueId = existingIssues[0].id;
      } else {
        // Create a new server-scoped issue for the channel lock
        const issueNumber = await getNextServerIssueNumber(driver);

        try {
          const createResult = await repository.createLockIssue({
            issueNumber,
            title: `[Locked channel] ${channelDisplayName}`,
            relatedChannelUniqueName: channelUniqueName,
            authorModName: loggedInModName,
          });
          finalIssueId = createResult.id || "";
          if (!finalIssueId) {
            throw new GraphQLError("Error creating issue for channel lock");
          }
        } catch (error) {
          logger.error("Error creating issue for channel lock:", error);
          throw new GraphQLError(
            `Error creating issue: ${(error as Error)?.message || "unknown error"}`
          );
        }
      }
    }

    // Record the moderation action (with its embedded moderator comment) on the
    // issue's activity feed. Owned Cypher — see channelModerationRepository.
    try {
      await repository.recordAction({
        issueId: finalIssueId,
        actionType: "lock_channel",
        actionDescription: "Locked the channel",
        commentText: `**Reason for locking:** ${reason}`,
        modName: loggedInModName,
        isOpen: true, // Keep the issue open
      });
    } catch (error) {
      logger.error("Error updating issue with lock action:", error);
      // Continue even if issue update fails - the channel lock is more important
    }

    // Lock the channel
    try {
      const updateResult = await repository.updateLockState({
          uniqueName: channelUniqueName,
          locked: true,
          lockReason: reason,
          lockedAt: new Date().toISOString(),
          modName: loggedInModName,
        });

      const updatedChannel = updateResult.channels[0];
      if (!updatedChannel) {
        throw new GraphQLError("Error locking channel");
      }

      // Notify channel admins
      const adminUsernames = existingChannel.Admins?.map(
        (admin: { username: string }) => admin.username
      ).filter(Boolean);

      if (adminUsernames?.length > 0) {
        const session = driver.session();
        try {
          await session.run(
            `
            UNWIND $usernames AS username
            MATCH (user:User {username: username})
            CREATE (notification:Notification {
              id: randomUUID(),
              createdAt: datetime(),
              read: false,
              text: $notificationText,
              notificationType: 'moderation'
            })
            CREATE (user)-[:HAS_NOTIFICATION]->(notification)
            RETURN count(notification) as notificationsCreated
            `,
            {
              usernames: adminUsernames,
              notificationText: `Your forum "${channelDisplayName}" has been locked. Reason: ${reason}`,
            }
          );
        } catch (notifyError) {
          logger.error("Error notifying channel admins:", notifyError);
          // Don't fail the mutation if notifications fail
        } finally {
          await session.close();
        }
      }

      logger.info(
        `✅ Channel ${channelUniqueName} locked by ${loggedInModName}`
      );
      return updatedChannel;
    } catch (error) {
      logger.error("Error locking channel:", error);
      throw new GraphQLError("Error locking channel");
    }
  };
};

export default getResolver;
