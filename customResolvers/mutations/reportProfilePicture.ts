import type {
  IssueModel,
  UserModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";

type Args = {
  username: string;
  reportText: string;
  selectedServerRules: string[];
};

type Input = {
  Issue: IssueModel;
  User: UserModel;
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
  const { Issue, User, driver } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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

    // Verify the user exists and has a profile picture
    const userData = await User.find({
      where: {
        username: username,
      },
      selectionSet: `{
        username
        displayName
        profilePicURL
      }`,
    });

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
    const existingIssueData = await Issue.find({
      where: {
        channelUniqueName: null,
        relatedProfilePicUserId: username,
      },
      selectionSet: `{
        id
        issueNumber
        flaggedServerRuleViolation
      }`,
    });

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

      const issueCreateInput: IssueCreateInput = {
        title: `[Reported profile picture] ${displayLabel}`,
        isOpen: true,
        authorName: loggedInModName,
        flaggedServerRuleViolation: true, // Profile picture reports always flag server rule violation
        channelUniqueName: null, // Server-scoped issue
        relatedProfilePicUserId: username,
        relatedUsername: username,
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
        console.error("Error creating profile picture report issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    const moderationActionCreateInput = getModerationActionCreateInput({
      text: finalCommentText,
      loggedInModName,
      actionType: "report",
      actionDescription: "Reported the profile picture",
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
      flaggedServerRuleViolation: true, // Profile picture reports always flag server rule violation
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
            relatedProfilePicUserId
          }
        }`,
      });
      const issueId = updateResult.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      return updateResult.issues[0];
    } catch (error) {
      console.error("Error updating profile picture report issue:", error);
      throw new GraphQLError("Error updating issue");
    }
  };
};

export default getResolver;
