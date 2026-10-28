import { createImageModerationRepository, type ImageModerationRepository } from "../../services/persistence/imageModerationRepository.js";
import type { Driver } from "neo4j-driver";
import type {
  Issue,
  IssueWhere,
  ImageUpdateInput,
  ImageWhere,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { logger } from "../../logger.js";

type Args = {
  imageId: string;
  explanation?: string;
  channelUniqueName?: string | null;
};

type Input = {
  repository?: ImageModerationRepository;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const repository = input.repository ?? createImageModerationRepository(input.driver);
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const { imageId, explanation, channelUniqueName } = args;

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
    const imageData = await repository.findUnarchiveTarget(imageId);

    if (imageData.length === 0) {
      throw new GraphQLError("Image not found");
    }

    const isServerScoped = !channelUniqueName;

    let existingIssueId = "";
    let existingIssue: Issue | null = null;

    // Check if an issue exists for this image
    const issueWhereClause: IssueWhere = {
      relatedImageId: { eq: imageId },
    };

    if (isServerScoped) {
      issueWhereClause.channelUniqueName = { eq: null };
    } else {
      issueWhereClause.channelUniqueName = { eq: channelUniqueName };
    }

    const issueData = await repository.findIssue(issueWhereClause);

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssue = issueData[0];
    } else {
      throw new GraphQLError("Issue not found for this image");
    }

    // Record the un-archive action then the close action via the owned write
    // (two appends). Comment Channel connect only when channel-scoped; text verbatim.
    const commentChannelUniqueName = channelUniqueName || undefined;
    try {
      await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "un-archive",
            actionDescription: "Un-archived the image",
            text: explanation ?? null,
            modDisplayName: loggedInModName,
            commentChannelUniqueName,
          },
        ],
      });

      const issueUpdateData = await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "close-issue",
            actionDescription: "Closed the issue",
            text: explanation ?? null,
            modDisplayName: loggedInModName,
            commentChannelUniqueName,
          },
        ],
        isOpen: false,
      });

      const issueId = issueUpdateData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      existingIssue = issueUpdateData.issues[0];

      await notifyIssueSubscribers({
        notificationSnapshotRepository: context.notificationSnapshotRepository,
        driver: context.driver,
        issueId,
        actorUsername: loggedInUsername,
        actionType: "un-archive",
        actionDescription: "Un-archived the image",
        commentText: explanation,
      });
    } catch (error) {
      logger.error("Error updating issue:", error);
      throw new GraphQLError("Error updating issue");
    }

    // Update the image to set archived=false
    try {
      const imageUpdateWhere: ImageWhere = {
        id: { eq: imageId },
      };
      const imageUpdateInput: ImageUpdateInput = {
        archived: { set: false },
      };

      const imageUpdateData = await repository.updateModerationState(imageUpdateWhere, imageUpdateInput);

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
