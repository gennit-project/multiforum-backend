import type {
  IssueModel,
  ChannelModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueUpdateInput,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";

type Args = {
  channelUniqueName: string;
  reason: string;
  issueId?: string;
};

type Input = {
  Issue: IssueModel;
  Channel: ChannelModel;
  driver: any;
};

const getResolver = (input: Input) => {
  const { Issue, Channel, driver } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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
      getPermissionInfo: false,
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
    const channelData = await Channel.find({
      where: { uniqueName: channelUniqueName },
      selectionSet: `{
        uniqueName
        displayName
        locked
        Admins {
          username
        }
      }`,
    });

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
      const existingIssues = await Issue.find({
        where: {
          channelUniqueName: null,
          relatedChannelUniqueName: channelUniqueName,
          isOpen: true,
        },
        selectionSet: `{
          id
          issueNumber
        }`,
      });

      if (existingIssues.length > 0) {
        finalIssueId = existingIssues[0].id;
      } else {
        // Create a new server-scoped issue for the channel lock
        const issueNumber = await getNextServerIssueNumber(driver);

        const issueCreateInput: IssueCreateInput = {
          title: `[Locked channel] ${channelDisplayName}`,
          isOpen: true,
          authorName: loggedInModName,
          flaggedServerRuleViolation: true,
          channelUniqueName: null, // Server-scoped issue
          relatedChannelUniqueName: channelUniqueName,
          issueNumber,
          Author: {
            ModerationProfile: {
              connect: {
                where: {
                  node: {
                    displayName: loggedInModName,
                  },
                },
              },
            },
          },
        };

        try {
          const createResult = await Issue.create({
            input: [issueCreateInput],
            selectionSet: `{
              issues {
                id
                issueNumber
              }
            }`,
          });
          finalIssueId = createResult.issues[0]?.id || "";
          if (!finalIssueId) {
            throw new GraphQLError("Error creating issue for channel lock");
          }
        } catch (error) {
          console.error("Error creating issue for channel lock:", error);
          throw new GraphQLError(
            `Error creating issue: ${(error as Error)?.message || "unknown error"}`
          );
        }
      }
    }

    // Create the moderation action for the activity feed
    const moderationActionCreateInput: ModerationActionCreateInput = {
      ModerationProfile: {
        connect: {
          where: {
            node: {
              displayName: loggedInModName,
            },
          },
        },
      },
      actionType: "lock_channel",
      actionDescription: "Locked the channel",
      Comment: {
        create: {
          node: {
            text: `**Reason for locking:** ${reason}`,
            isRootComment: true,
            CommentAuthor: {
              ModerationProfile: {
                connect: {
                  where: {
                    node: {
                      displayName: loggedInModName,
                    },
                  },
                },
              },
            },
            Issue: {
              connect: {
                where: {
                  node: {
                    id: finalIssueId,
                  },
                },
              },
            },
          },
        },
      },
    };

    // Update the issue with the moderation action
    const issueUpdateInput: IssueUpdateInput = {
      isOpen: true, // Keep the issue open
      ActivityFeed: [
        {
          create: [
            {
              node: moderationActionCreateInput,
            },
          ],
        },
      ],
    };

    try {
      await Issue.update({
        where: { id: finalIssueId },
        update: issueUpdateInput,
      });
    } catch (error) {
      console.error("Error updating issue with lock action:", error);
      // Continue even if issue update fails - the channel lock is more important
    }

    // Lock the channel
    try {
      const updateResult = await Channel.update({
        where: { uniqueName: channelUniqueName },
        update: {
          locked: true,
          lockedAt: new Date().toISOString(),
          lockReason: reason,
          LockedBy: {
            connect: {
              where: {
                node: {
                  displayName: loggedInModName,
                },
              },
            },
          },
        },
        selectionSet: `{
          channels {
            uniqueName
            displayName
            locked
            lockedAt
            lockReason
            LockedBy {
              displayName
            }
          }
        }`,
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
              text: $notificationText
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
          console.error("Error notifying channel admins:", notifyError);
          // Don't fail the mutation if notifications fail
        } finally {
          await session.close();
        }
      }

      console.log(
        `✅ Channel ${channelUniqueName} locked by ${loggedInModName}`
      );
      return updatedChannel;
    } catch (error) {
      console.error("Error locking channel:", error);
      throw new GraphQLError("Error locking channel");
    }
  };
};

export default getResolver;
