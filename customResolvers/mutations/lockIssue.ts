import type {
  IssueModel,
  IssueWhere,
  IssueUpdateInput,
  ModerationActionCreateInput,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";

type Args = {
  issueId: string;
  reason: string;
};

type Input = {
  Issue: IssueModel;
};

const getResolver = (input: Input) => {
  const { Issue } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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

    // Find the issue and check if it exists
    const issueData = await Issue.find({
      where: { id: issueId },
      selectionSet: `{
        id
        issueNumber
        channelUniqueName
        locked
      }`,
    });

    if (issueData.length === 0) {
      throw new GraphQLError("Issue not found");
    }

    const existingIssue = issueData[0];

    if (existingIssue.locked) {
      throw new GraphQLError("Issue is already locked");
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
      actionType: "lock",
      actionDescription: "Locked the issue",
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
          },
        },
      },
    };

    // Update the issue with locked status and activity feed entry
    const issueUpdateWhere: IssueWhere = {
      id: issueId,
    };

    const issueUpdateInput: IssueUpdateInput = {
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
      const updateResult = await Issue.update({
        where: issueUpdateWhere,
        update: issueUpdateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            channelUniqueName
            locked
            lockedAt
            lockReason
            LockedBy {
              displayName
            }
            ActivityFeed {
              id
              actionType
              actionDescription
              createdAt
              ModerationProfile {
                displayName
              }
            }
          }
        }`,
      });

      const updatedIssue = updateResult.issues[0];
      if (!updatedIssue) {
        throw new GraphQLError("Error updating issue");
      }

      console.log(`✅ Issue ${existingIssue.issueNumber} locked by ${loggedInModName}`);
      return updatedIssue;
    } catch (error) {
      console.error("Error locking issue:", error);
      throw new GraphQLError("Error locking issue");
    }
  };
};

export default getResolver;
