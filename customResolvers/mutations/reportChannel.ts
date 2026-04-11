import type {
  IssueModel,
  ChannelModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";

type Args = {
  channelUniqueName: string;
  reportText: string;
  selectedServerRules: string[];
};

type Input = {
  Issue: IssueModel;
  Channel: ChannelModel;
  driver: any;
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

const getModerationActionCreateInput = (input: {
  text?: string;
  loggedInModName: string;
  actionType: string;
  actionDescription: string;
  issueId: string;
}): ModerationActionCreateInput => {
  const { text, loggedInModName, actionType, actionDescription, issueId } =
    input;

  return {
    ModerationProfile: {
      connect: {
        where: {
          node: {
            displayName: loggedInModName,
          },
        },
      },
    },
    actionType,
    actionDescription,
    Comment: {
      create: {
        node: {
          text: text || null,
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
                  id: issueId,
                },
              },
            },
          },
        },
      },
    },
  };
};

const getResolver = (input: Input) => {
  const { Issue, Channel, driver } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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

    // Verify the channel exists
    const channelData = await Channel.find({
      where: {
        uniqueName: channelUniqueName,
      },
      selectionSet: `{
        uniqueName
        displayName
      }`,
    });

    if (channelData.length === 0) {
      throw new GraphQLError("Channel not found");
    }

    const channel = channelData[0];
    const channelDisplayName = channel.displayName || channelUniqueName;

    let existingIssueId = "";
    let existingIssueFlaggedServerRuleViolation = false;

    // Check if an issue already exists for this channel (server-scoped, relatedChannelUniqueName matches)
    const issueData = await Issue.find({
      where: {
        channelUniqueName: null,
        relatedChannelUniqueName: channelUniqueName,
      },
      selectionSet: `{
        id
        issueNumber
        flaggedServerRuleViolation
      }`,
    });

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

      const issueCreateInput: IssueCreateInput = {
        title: `[Reported channel] ${channelDisplayName}`,
        isOpen: true,
        authorName: loggedInModName,
        flaggedServerRuleViolation: true, // Channel reports always flag server rule violation
        channelUniqueName: null, // Server-scoped issue (no channel association)
        relatedChannelUniqueName: channelUniqueName, // The channel being reported
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
        // No Channel connection for server-scoped issues
      };

      try {
        const createResult = await Issue.create({
          input: [issueCreateInput],
          selectionSet: `{
            issues {
              id
              issueNumber
              flaggedServerRuleViolation
            }
          }`,
        });
        const issueId = createResult.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
      } catch (error) {
        console.error("Error creating channel report issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    const moderationActionCreateInput = getModerationActionCreateInput({
      text: finalCommentText,
      loggedInModName,
      actionType: "report",
      actionDescription: "Reported the channel",
      issueId: existingIssueId,
    });

    // Update the issue with the new moderation action.
    const issueUpdateWhere: IssueWhere = {
      id: existingIssueId,
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
      isOpen: true, // Reopen the issue if it was closed
      flaggedServerRuleViolation: true, // Channel reports always flag server rule violation
    };

    try {
      const updateResult = await Issue.update({
        where: issueUpdateWhere,
        update: issueUpdateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
            relatedChannelUniqueName
          }
        }`,
      });
      const issueId = updateResult.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      return updateResult.issues[0];
    } catch (error) {
      console.error("Error updating channel report issue:", error);
      throw new GraphQLError("Error updating issue");
    }
  };
};

export default getResolver;
