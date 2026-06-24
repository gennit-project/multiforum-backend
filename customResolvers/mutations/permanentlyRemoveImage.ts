import type {
  Issue,
  IssueModel,
  ImageModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
  ImageUpdateInput,
  ImageWhere,
} from "../../ogm_types.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { logger } from "../../logger.js";

type Args = {
  imageId: string;
  explanation?: string;
};

type Input = {
  Issue: IssueModel;
  Image: ImageModel;
  driver: Driver;
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
  const { Issue, Image, driver } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { imageId, explanation } = args;

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
        url
        permanentlyRemoved
        Uploader {
          username
        }
      }`,
    });

    if (imageData.length === 0) {
      throw new GraphQLError("Image not found");
    }

    const image = imageData[0];

    if (image.permanentlyRemoved) {
      throw new GraphQLError("Image has already been permanently removed");
    }

    const uploaderUsername = image.Uploader?.username;
    const imageUrl = image.url || "unknown";
    const truncatedUrl =
      imageUrl.length > 30 ? imageUrl.substring(0, 30) + "..." : imageUrl;

    let existingIssueId = "";
    let existingIssue: Issue | null = null;

    // Check if a server-scoped issue exists for this image
    const issueWhereClause: IssueWhere = {
      relatedImageId: imageId,
      channelUniqueName: null, // Server-scoped
    };

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
      existingIssue = existingIssueData[0];
    }

    // If an issue does NOT already exist, create a new server-scoped issue.
    if (!existingIssueId) {
      const issueNumber = await getNextServerIssueNumber(driver);

      const issueCreateInput: IssueCreateInput = {
        title: `[Permanently removed image] ${truncatedUrl}`,
        isOpen: true,
        authorName: loggedInModName,
        flaggedServerRuleViolation: true,
        channelUniqueName: null,
        relatedImageId: imageId,
        relatedUsername: uploaderUsername || undefined,
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
              flaggedServerRuleViolation
            }
          }`,
        });
        const issueId = createResult.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
        existingIssue = createResult.issues[0];
      } catch (error) {
        logger.error("Error creating permanent removal issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    const removeModActionCreateInput = getModerationActionCreateInput({
      text: explanation,
      loggedInModName,
      actionType: "permanent-removal",
      actionDescription: "Permanently removed the image",
      issueId: existingIssueId,
    });

    const closeIssueModActionCreateInput = getModerationActionCreateInput({
      text: explanation,
      loggedInModName,
      actionType: "close",
      actionDescription: "Closed the issue",
      issueId: existingIssueId,
    });

    // Update the issue with the permanent removal action
    const issueUpdateWhere: IssueWhere = {
      id: existingIssueId,
    };

    const removeUpdateIssueInput: IssueUpdateInput = {
      ActivityFeed: [
        {
          create: [
            {
              node: removeModActionCreateInput,
            },
          ],
        },
      ],
      flaggedServerRuleViolation: true,
    };

    const closeIssueUpdateInput: IssueUpdateInput = {
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
        update: removeUpdateIssueInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`,
      });

      const issueData = await Issue.update({
        where: issueUpdateWhere,
        update: closeIssueUpdateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`,
      });

      const issueId = issueData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      existingIssue = issueData.issues[0];

      await notifyIssueSubscribers({
        IssueModel: Issue,
        driver: context.driver,
        issueId,
        actorUsername: loggedInUsername,
        actionType: "permanent-removal",
        actionDescription: "Permanently removed the image",
        commentText: explanation,
      });
    } catch (error) {
      logger.error("Error updating issue:", error);
      throw new GraphQLError("Error updating issue");
    }

    // Update the image to set permanentlyRemoved=true and link the mod
    try {
      const imageUpdateWhere: ImageWhere = {
        id: imageId,
      };
      const imageUpdateInput: ImageUpdateInput = {
        permanentlyRemoved: true,
        permanentlyRemovedAt: new Date().toISOString(),
        PermanentlyRemovedByMod: {
          connect: {
            where: {
              node: {
                displayName: loggedInModName,
              },
            },
          },
        },
        RelatedIssues: [
          {
            connect: [
              {
                where: {
                  node: {
                    id: existingIssueId,
                  },
                },
              },
            ],
          },
        ],
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
      logger.error("Error updating image:", error);
      throw new GraphQLError("Error updating image");
    }
  };
};

export default getResolver;
