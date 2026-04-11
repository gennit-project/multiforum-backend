import type {
  Issue,
  IssueModel,
  ImageModel,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
  ImageUpdateInput,
  ImageWhere,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";

type Args = {
  imageId: string;
  explanation?: string;
  channelUniqueName?: string | null;
};

type Input = {
  Issue: IssueModel;
  Image: ImageModel;
};

const getModerationActionCreateInput = (input: {
  text?: string;
  loggedInModName: string;
  channelUniqueName?: string | null;
  actionType: string;
  actionDescription: string;
  issueId: string;
}): ModerationActionCreateInput => {
  const {
    text,
    loggedInModName,
    channelUniqueName,
    actionType,
    actionDescription,
    issueId,
  } = input;

  const baseInput: ModerationActionCreateInput = {
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

  if (channelUniqueName && baseInput.Comment?.create?.node) {
    baseInput.Comment.create.node.Channel = {
      connect: {
        where: {
          node: {
            uniqueName: channelUniqueName,
          },
        },
      },
    };
  }

  return baseInput;
};

const getResolver = (input: Input) => {
  const { Issue, Image } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { imageId, explanation, channelUniqueName } = args;

    if (!imageId) {
      throw new GraphQLError("Image ID is required");
    }

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

    // Verify the image exists
    const imageData = await Image.find({
      where: {
        id: imageId,
      },
      selectionSet: `{
        id
        archived
      }`,
    });

    if (imageData.length === 0) {
      throw new GraphQLError("Image not found");
    }

    const isServerScoped = !channelUniqueName;

    let existingIssueId = "";
    let existingIssue: Issue | null = null;

    // Check if an issue exists for this image
    const issueWhereClause: IssueWhere = {
      relatedImageId: imageId,
    };

    if (isServerScoped) {
      issueWhereClause.channelUniqueName = null;
    } else {
      issueWhereClause.channelUniqueName = channelUniqueName;
    }

    const issueData = await Issue.find({
      where: issueWhereClause,
      selectionSet: `{
        id
        issueNumber
        flaggedServerRuleViolation
      }`,
    });

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssue = issueData[0];
    } else {
      throw new GraphQLError("Issue not found for this image");
    }

    const unarchiveModActionCreateInput = getModerationActionCreateInput({
      text: explanation,
      loggedInModName,
      channelUniqueName,
      actionType: "un-archive",
      actionDescription: "Un-archived the image",
      issueId: existingIssueId,
    });

    const closeIssueModActionCreateInput = getModerationActionCreateInput({
      text: explanation,
      loggedInModName,
      channelUniqueName,
      actionType: "close-issue",
      actionDescription: "Closed the issue",
      issueId: existingIssueId,
    });

    // Update the issue with the unarchive action
    const issueUpdateWhere: IssueWhere = {
      id: existingIssueId,
    };

    const unarchiveUpdateInput: IssueUpdateInput = {
      ActivityFeed: [
        {
          create: [
            {
              node: unarchiveModActionCreateInput,
            },
          ],
        },
      ],
    };

    const issueCloseUpdateInput: IssueUpdateInput = {
      isOpen: false,
      ActivityFeed: [
        {
          create: [
            {
              node: closeIssueModActionCreateInput,
            },
          ],
        },
      ],
    };

    try {
      await Issue.update({
        where: issueUpdateWhere,
        update: unarchiveUpdateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`,
      });

      const issueUpdateData = await Issue.update({
        where: issueUpdateWhere,
        update: issueCloseUpdateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`,
      });

      const issueId = issueUpdateData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      existingIssue = issueUpdateData.issues[0];

      await notifyIssueSubscribers({
        IssueModel: Issue,
        driver: context.driver,
        issueId,
        actorUsername: loggedInUsername,
        actionType: "un-archive",
        actionDescription: "Un-archived the image",
        commentText: explanation,
      });
    } catch (error) {
      console.error("Error updating issue:", error);
      throw new GraphQLError("Error updating issue");
    }

    // Update the image to set archived=false
    try {
      const imageUpdateWhere: ImageWhere = {
        id: imageId,
      };
      const imageUpdateInput: ImageUpdateInput = {
        archived: false,
      };

      const imageUpdateData = await Image.update({
        where: imageUpdateWhere,
        update: imageUpdateInput,
      });

      const imageUpdateId = imageUpdateData.images[0]?.id || null;
      if (!imageUpdateId) {
        throw new GraphQLError("Error updating image");
      }

      return existingIssue;
    } catch (error) {
      console.error("Error updating image:", error);
      throw new GraphQLError("Error updating image");
    }
  };
};

export default getResolver;
