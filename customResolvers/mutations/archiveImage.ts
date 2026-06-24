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
import getNextIssueNumber from "./utils/getNextIssueNumber.js";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { notifyArchivedContentAuthor } from "../../hooks/archivedContentNotificationHook.js";

type Args = {
  imageId: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  reportText: string;
  channelUniqueName?: string | null;
};

type Input = {
  Issue: IssueModel;
  Image: ImageModel;
  driver: Driver;
};

const getFinalCommentText = (input: {
  selectedForumRules: string[];
  selectedServerRules: string[];
  reportText: string;
}) => {
  const { selectedForumRules, selectedServerRules, reportText } = input;
  return `
${
  selectedForumRules.length > 0
    ? `Forum rule violations: ${selectedForumRules.join(", ")}
`
    : ""
}
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
  const { Issue, Image, driver } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const {
      imageId,
      selectedForumRules,
      selectedServerRules,
      reportText,
      channelUniqueName,
    } = args;

    if (!imageId) {
      throw new GraphQLError("Image ID is required");
    }

    const isServerScoped = !channelUniqueName;
    const atLeastOneViolation =
      (selectedForumRules?.length ?? 0) > 0 ||
      (selectedServerRules?.length ?? 0) > 0;

    if (!atLeastOneViolation) {
      throw new GraphQLError("At least one rule must be selected");
    }

    if (isServerScoped && (selectedServerRules?.length ?? 0) === 0) {
      throw new GraphQLError(
        "At least one server rule must be selected for server-scoped archives"
      );
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
        archived
        Uploader {
          username
        }
      }`,
    });

    if (imageData.length === 0) {
      throw new GraphQLError("Image not found");
    }

    const image = imageData[0];
    const uploaderUsername = image.Uploader?.username;
    const imageUrl = image.url || "unknown";
    const truncatedUrl =
      imageUrl.length > 30 ? imageUrl.substring(0, 30) + "..." : imageUrl;

    let existingIssueId = "";
    let existingIssue: Issue | null = null;
    let existingIssueFlaggedServerRuleViolation = false;

    // Check if an issue already exists for this image
    const issueWhereClause: IssueWhere = {
      relatedImageId: imageId,
    };

    if (isServerScoped) {
      issueWhereClause.channelUniqueName = null;
    } else {
      issueWhereClause.channelUniqueName = channelUniqueName;
    }

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
      existingIssueFlaggedServerRuleViolation =
        existingIssueData[0]?.flaggedServerRuleViolation || false;
    }

    const finalCommentText = getFinalCommentText({
      reportText,
      selectedForumRules: selectedForumRules || [],
      selectedServerRules: selectedServerRules || [],
    });

    // If an issue does NOT already exist, create a new issue.
    if (!existingIssueId) {
      const issueNumber = isServerScoped
        ? await getNextServerIssueNumber(driver)
        : await getNextIssueNumber(driver, channelUniqueName!);

      const issueCreateInput: IssueCreateInput = {
        title: `[Archived image] ${truncatedUrl}`,
        isOpen: true,
        authorName: loggedInModName,
        flaggedServerRuleViolation: (selectedServerRules?.length ?? 0) > 0,
        channelUniqueName: channelUniqueName || null,
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

      if (channelUniqueName) {
        issueCreateInput.Channel = {
          connect: {
            where: {
              node: {
                uniqueName: channelUniqueName,
              },
            },
          },
        };
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
        existingIssue = createResult.issues[0];
      } catch (error) {
        console.error("Error creating image archive issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    const archiveModActionCreateInput = getModerationActionCreateInput({
      text: finalCommentText,
      loggedInModName,
      channelUniqueName,
      actionType: "archive",
      actionDescription: "Archived the image",
      issueId: existingIssueId,
    });

    const closeIssueModActionCreateInput = getModerationActionCreateInput({
      text: finalCommentText,
      loggedInModName,
      channelUniqueName,
      actionType: "close",
      actionDescription: "Closed the issue",
      issueId: existingIssueId,
    });

    // Update the issue with the archive action
    const issueUpdateWhere: IssueWhere = {
      id: existingIssueId,
    };

    const archiveUpdateIssueInput: IssueUpdateInput = {
      ActivityFeed: [
        {
          create: [
            {
              node: archiveModActionCreateInput,
            },
          ],
        },
      ],
      flaggedServerRuleViolation:
        existingIssueFlaggedServerRuleViolation ||
        (selectedServerRules?.length ?? 0) > 0,
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
        update: archiveUpdateIssueInput,
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
        actionType: "archive",
        actionDescription: "Archived the image",
        commentText: finalCommentText,
      });
    } catch (error) {
      console.error("Error updating issue:", error);
      throw new GraphQLError("Error updating issue");
    }

    // Update the image to set archived=true and link the issue
    try {
      const imageUpdateWhere: ImageWhere = {
        id: imageId,
      };
      const imageUpdateInput: ImageUpdateInput = {
        archived: true,
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

      // Notify the image uploader that their content was archived
      const issueNumber = existingIssue?.issueNumber;
      if (uploaderUsername && issueNumber) {
        const baseUrl = process.env.FRONTEND_URL || '';
        // Image URLs vary - use the image ID as the content reference
        const contentUrl = channelUniqueName
          ? `${baseUrl}/forums/${channelUniqueName}/images/${imageId}`
          : `${baseUrl}/images/${imageId}`;

        await notifyArchivedContentAuthor({
          context: { ogm: context.ogm, driver: context.driver },
          contentType: 'image',
          authorUsername: uploaderUsername,
          contentUrl,
          channelUniqueName: channelUniqueName || 'server',
          issueNumber,
          moderatorUsername: loggedInUsername,
        });
      }

      return existingIssue;
    } catch (error) {
      console.error("Error updating image:", error);
      throw new GraphQLError("Error updating image");
    }
  };
};

export default getResolver;
