import { createImageReportRepository, type ImageReportRepository } from "../../services/persistence/imageReportRepository.js";
import type { IssueWhere } from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";
import getNextServerIssueNumber from "./utils/getNextServerIssueNumber.js";
import { logger } from "../../logger.js";

type Args = {
  imageId: string;
  reportText: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  channelUniqueName?: string | null; // null for server-scoped (e.g., profile pictures)
};

type Input = {
  imageReportRepository?: ImageReportRepository;
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
  const repository = input.imageReportRepository ?? createImageReportRepository(driver);
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
    const imageData = await repository.findReportedImage(imageId);

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
      relatedImageId: { eq: imageId },
    };

    if (isServerScoped) {
      issueWhereClause.channelUniqueName = { eq: null };
    } else {
      issueWhereClause.channelUniqueName = { eq: channelUniqueName };
    }

    const existingIssueData = await repository.findPriorImageReport(issueWhereClause);

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

      try {
        const createResult = await repository.createImageReportIssue({
          issueNumber,
          title: `[Reported image] ${truncatedUrl}`,
          authorModName: loggedInModName,
          // channel-scoped → scalar + best-effort HAS_ISSUE connect; null → server-scoped.
          channelUniqueName: channelUniqueName || null,
          flaggedServerRuleViolation: (selectedServerRules?.length ?? 0) > 0,
          relatedImageId: imageId, // → TARGETS_IMAGE
          relatedUsername: uploaderUsername || undefined, // → TARGETS_USER
        });
        const issueId = createResult.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
      } catch (error) {
        logger.error("Error creating image report issue:", error);
        throw new GraphQLError(
          `Error creating issue: ${(error as Error)?.message || "unknown error"}`
        );
      }
    }

    // Append the report moderation action (with its embedded moderator comment)
    // via the owned moderation write. The comment's Channel connect is only made
    // when channel-scoped; the comment text is stored verbatim (no wrapping).
    try {
      const updateResult = await repository.appendImageReport({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "report",
            actionDescription: "Reported the image",
            text: finalCommentText,
            modDisplayName: loggedInModName,
            commentChannelUniqueName: channelUniqueName || undefined,
          },
        ],
        isOpen: true, // Reopen the issue if it was closed
        flaggedServerRuleViolation:
          existingIssueFlaggedServerRuleViolation ||
          (selectedServerRules?.length ?? 0) > 0,
      });
      const issueId = updateResult.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      return updateResult.issues[0];
    } catch (error) {
      logger.error("Error updating image report issue:", error);
      throw new GraphQLError("Error updating issue");
    }
  };
};

export default getResolver;
