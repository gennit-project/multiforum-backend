import type {
  IssueModel,
  ChannelModel,
  ModerationActionCreateInput,
  IssueUpdateInput,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";

type Args = {
  channelUniqueName: string;
  reason?: string;
};

type Input = {
  Issue: IssueModel;
  Channel: ChannelModel;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { Issue, Channel, driver } = input;
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const { channelUniqueName, reason } = args;

    if (!channelUniqueName) {
      throw new GraphQLError("Channel unique name is required");
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

    if (!existingChannel.locked) {
      throw new GraphQLError("Channel is not locked");
    }

    const channelDisplayName =
      existingChannel.displayName || channelUniqueName;

    // Find the related issue for this channel (if any)
    const existingIssues = await Issue.find({
      where: {
        channelUniqueName: null,
        relatedChannelUniqueName: channelUniqueName,
      },
      selectionSet: `{
        id
        issueNumber
        isOpen
      }`,
    });

    const relatedIssue = existingIssues[0];

    // If there's a related issue, add a moderation action to it
    if (relatedIssue?.id) {
      const actionText = reason
        ? `**Reason for unlocking:** ${reason}`
        : "Channel unlocked";

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
        actionType: "unlock_channel",
        actionDescription: "Unlocked the channel",
        Comment: {
          create: {
            node: {
              text: actionText,
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
                      id: relatedIssue.id,
                    },
                  },
                },
              },
            },
          },
        },
      };

      const issueUpdateInput: IssueUpdateInput = {
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
          where: { id: relatedIssue.id },
          update: issueUpdateInput,
        });
      } catch (error) {
        console.error("Error updating issue with unlock action:", error);
        // Continue even if issue update fails - the channel unlock is more important
      }
    }

    // Unlock the channel
    try {
      const updateResult = await Channel.update({
        where: { uniqueName: channelUniqueName },
        update: {
          locked: false,
          lockedAt: null,
          lockReason: null,
          LockedBy: {
            disconnect: {
              where: {
                node: {
                  displayName_NOT: null, // Disconnect any connected ModerationProfile
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
        throw new GraphQLError("Error unlocking channel");
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
              notificationText: `Your forum "${channelDisplayName}" has been unlocked.${reason ? ` Reason: ${reason}` : ""}`,
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
        `✅ Channel ${channelUniqueName} unlocked by ${loggedInModName}`
      );
      return updatedChannel;
    } catch (error) {
      console.error("Error unlocking channel:", error);
      throw new GraphQLError("Error unlocking channel");
    }
  };
};

export default getResolver;
