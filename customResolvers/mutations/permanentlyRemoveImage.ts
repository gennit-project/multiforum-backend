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
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { logger } from "../../logger.js";

type Args = {
  imageId: string;
  explanation?: string;
};

type Input = {
  repository?: ImageModerationRepository;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.repository ?? createImageModerationRepository(driver);
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { imageId, explanation } = args;

    if (!imageId) {
      throw new GraphQLError("Image ID is required");
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
    const imageData = await repository.findPermanentRemovalTarget(imageId);

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
      relatedImageId: { eq: imageId },
      channelUniqueName: { eq: null }, // Server-scoped
    };

    const existingIssueData = await repository.findIssue(issueWhereClause);

    if (existingIssueData.length > 0) {
      existingIssueId = existingIssueData[0]?.id || "";
      existingIssue = existingIssueData[0];
    }

    // If an issue does NOT already exist, create a new server-scoped issue.
    if (!existingIssueId) {
      const issueNumber = await getNextServerIssueNumber(driver);

      try {
        const createResult = await repository.createModerationIssue({
          issueNumber,
          title: `[Permanently removed image] ${truncatedUrl}`,
          authorModName: loggedInModName,
          channelUniqueName: null, // Server-scoped
          flaggedServerRuleViolation: true,
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
        logger.error("Error creating permanent removal issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    // Record the permanent-removal action then the close action via the owned
    // write (two appends). Server-scoped: no comment Channel connect; text verbatim.
    try {
      await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "permanent-removal",
            actionDescription: "Permanently removed the image",
            text: explanation ?? null,
            modDisplayName: loggedInModName,
          },
        ],
        flaggedServerRuleViolation: true,
      });

      const issueData = await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "close",
            actionDescription: "Closed the issue",
            text: explanation ?? null,
            modDisplayName: loggedInModName,
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
        id: { eq: imageId },
      };
      // PermanentlyRemovedByMod is a to-one relationship (no generated connect in
      // v7); set the scalars + to-many RelatedIssues via the generated API, then
      // wire the moderator edge with the owned write.
      const imageUpdateInput: ImageUpdateInput = {
        permanentlyRemoved: { set: true },
        permanentlyRemovedAt: { set: new Date().toISOString() },
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

      await repository.connectPermanentlyRemovedByMod(imageId, loggedInModName);

      return existingIssue;
    } catch (error) {
      logger.error("Error updating image:", error);
      throw new GraphQLError("Error updating image");
    }
  };
};

export default getResolver;
