import { createImageModerationRepository, type ImageModerationRepository } from "../../services/persistence/imageModerationRepository.js";
import type {
  Issue,
  IssueWhere,
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
import { logger } from "../../logger.js";

type Args = {
  imageId: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  reportText: string;
  channelUniqueName?: string | null;
};

type Input = {
  repository?: ImageModerationRepository;
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

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.repository ?? createImageModerationRepository(driver);
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
    const imageData = await repository.findArchiveTarget(imageId);

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
      relatedImageId: { eq: imageId },
    };

    if (isServerScoped) {
      issueWhereClause.channelUniqueName = { eq: null };
    } else {
      issueWhereClause.channelUniqueName = { eq: channelUniqueName };
    }

    const existingIssueData = await repository.findIssue(issueWhereClause);

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

      try {
        const createResult = await repository.createModerationIssue({
          issueNumber,
          title: `[Archived image] ${truncatedUrl}`,
          authorModName: loggedInModName,
          channelUniqueName: channelUniqueName || null,
          flaggedServerRuleViolation: (selectedServerRules?.length ?? 0) > 0,
          relatedImageId: imageId,
          relatedUsername: uploaderUsername || undefined,
        });
        const issueId = createResult.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
        existingIssue = createResult.issues[0];
      } catch (error) {
        logger.error("Error creating image archive issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    // Record the archive action then the close action via the owned write
    // (two appends). Comment Channel connect only when channel-scoped; text
    // stored verbatim.
    const commentChannelUniqueName = channelUniqueName || undefined;
    try {
      await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "archive",
            actionDescription: "Archived the image",
            text: finalCommentText,
            modDisplayName: loggedInModName,
            commentChannelUniqueName,
          },
        ],
        flaggedServerRuleViolation:
          existingIssueFlaggedServerRuleViolation ||
          (selectedServerRules?.length ?? 0) > 0,
      });

      const issueData = await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "close",
            actionDescription: "Closed the issue",
            text: finalCommentText,
            modDisplayName: loggedInModName,
            commentChannelUniqueName,
          },
        ],
        isOpen: false,
      });

      const issueId = issueData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      existingIssue = issueData.issues[0];

      await notifyIssueSubscribers({
        notificationSnapshotRepository: context.notificationSnapshotRepository,
        driver: context.driver,
        issueId,
        actorUsername: loggedInUsername,
        actionType: "archive",
        actionDescription: "Archived the image",
        commentText: finalCommentText,
      });
    } catch (error) {
      logger.error("Error updating issue:", error);
      throw new GraphQLError("Error updating issue");
    }

    // Update the image to set archived=true and link the issue
    try {
      const imageUpdateWhere: ImageWhere = {
        id: { eq: imageId },
      };
      const imageUpdateInput: ImageUpdateInput = {
        archived: { set: true },
        RelatedIssues: [
          {
            connect: [
              {
                where: {
                  node: {
                    id: { eq: existingIssueId },
                  },
                },
              },
            ],
          },
        ],
      };

      const imageUpdateData = await repository.updateModerationState(imageUpdateWhere, imageUpdateInput);

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
          context: { driver: context.driver, notificationSnapshotRepository: context.notificationSnapshotRepository, notificationWriter: context.notificationWriter },
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
      logger.error("Error updating image:", error);
      throw new GraphQLError("Error updating image");
    }
  };
};

export default getResolver;
