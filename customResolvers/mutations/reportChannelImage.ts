import type {
  IssueModel,
  ChannelModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
} from "../../ogm_types.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";
import { logger } from "../../logger.js";

type ChannelImageType = "ICON" | "BANNER";

type Args = {
  channelUniqueName: string;
  imageType: ChannelImageType;
  reportText: string;
  selectedServerRules: string[];
};

type Input = {
  Issue: IssueModel;
  Channel: ChannelModel;
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
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { channelUniqueName, imageType, reportText, selectedServerRules } =
      args;

    if (!channelUniqueName) {
      throw new GraphQLError("Channel unique name is required");
    }

    if (!imageType || !["ICON", "BANNER"].includes(imageType)) {
      throw new GraphQLError("Image type must be ICON or BANNER");
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

    // Verify the channel exists and has the specified image type
    const channelData = await Channel.find({
      where: {
        uniqueName: channelUniqueName,
      },
      selectionSet: `{
        uniqueName
        displayName
        channelIconURL
        channelBannerURL
      }`,
    });

    if (channelData.length === 0) {
      throw new GraphQLError("Channel not found");
    }

    const channel = channelData[0];
    const imageUrl =
      imageType === "ICON" ? channel.channelIconURL : channel.channelBannerURL;

    if (!imageUrl) {
      throw new GraphQLError(
        `Channel does not have a ${imageType.toLowerCase()}`
      );
    }

    const channelDisplayName = channel.displayName || channelUniqueName;
    const imageTypeLabel = imageType === "ICON" ? "icon" : "banner";

    let existingIssueId = "";
    let existingIssueFlaggedServerRuleViolation = false;

    // Build the where clause based on image type
    const issueWhereClause: IssueWhere = {
      channelUniqueName: null, // Server-scoped
    };

    if (imageType === "ICON") {
      issueWhereClause.relatedChannelIconName = channelUniqueName;
    } else {
      issueWhereClause.relatedChannelBannerName = channelUniqueName;
    }

    // Check if an issue already exists for this channel image (server-scoped)
    const existingIssueData = await Issue.find({
      where: issueWhereClause,
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
        title: `[Reported channel ${imageTypeLabel}] ${channelDisplayName}`,
        isOpen: true,
        authorName: loggedInModName,
        flaggedServerRuleViolation: true, // Channel image reports always flag server rule violation
        channelUniqueName: null, // Server-scoped issue
        relatedChannelUniqueName: channelUniqueName, // The channel whose image is being reported
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

      // Set the appropriate related field based on image type
      if (imageType === "ICON") {
        issueCreateInput.relatedChannelIconName = channelUniqueName;
      } else {
        issueCreateInput.relatedChannelBannerName = channelUniqueName;
      }

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
        logger.error("Error creating channel image report issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    const moderationActionCreateInput = getModerationActionCreateInput({
      text: finalCommentText,
      loggedInModName,
      actionType: "report",
      actionDescription: `Reported the channel ${imageTypeLabel}`,
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
      flaggedServerRuleViolation: true, // Channel image reports always flag server rule violation
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
            relatedChannelIconName
            relatedChannelBannerName
          }
        }`,
      });
      const issueId = updateResult.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      return updateResult.issues[0];
    } catch (error) {
      logger.error("Error updating channel image report issue:", error);
      throw new GraphQLError("Error updating issue");
    }
  };
};

export default getResolver;
