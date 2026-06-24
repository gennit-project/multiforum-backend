import type {
  IssueModel,
  ImageModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";

type Args = {
  imageId: string;
  reportText: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  channelUniqueName?: string | null; // null for server-scoped (e.g., profile pictures)
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

  // Only connect to channel if channel-scoped
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
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const {
      imageId,
      reportText,
      selectedForumRules,
      selectedServerRules,
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

    // Server-scoped reports must have server rules
    if (isServerScoped && (selectedServerRules?.length ?? 0) === 0) {
      throw new GraphQLError(
        "At least one server rule must be selected for server-scoped reports"
      );
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

    // Verify the image exists and get uploader info
    const imageData = await Image.find({
      where: {
        id: imageId,
      },
      selectionSet: `{
        id
        url
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
        relatedUsername
      }`,
    });

    if (existingIssueData.length > 0) {
      existingIssueId = existingIssueData[0]?.id || "";
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
        title: `[Reported image] ${truncatedUrl}`,
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

      // Only connect to channel if channel-scoped
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
      } catch (error) {
        console.error("Error creating image report issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    const moderationActionCreateInput = getModerationActionCreateInput({
      text: finalCommentText,
      loggedInModName,
      channelUniqueName,
      actionType: "report",
      actionDescription: "Reported the image",
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
      flaggedServerRuleViolation:
        existingIssueFlaggedServerRuleViolation ||
        (selectedServerRules?.length ?? 0) > 0,
    };

    // Update relatedUsername if not already set
    const existingIssue = existingIssueData[0];
    if (!existingIssue?.relatedUsername && uploaderUsername) {
      issueUpdateInput.relatedUsername = uploaderUsername;
    }

    try {
      const updateResult = await Issue.update({
        where: issueUpdateWhere,
        update: issueUpdateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
            relatedImageId
          }
        }`,
      });
      const issueId = updateResult.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      return updateResult.issues[0];
    } catch (error) {
      console.error("Error updating image report issue:", error);
      throw new GraphQLError("Error updating issue");
    }
  };
};

export default getResolver;
