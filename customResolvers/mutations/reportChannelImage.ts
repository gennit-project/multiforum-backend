import {createChannelImageReportRepository,type ChannelImageReportRepository} from "../../services/persistence/channelImageReportRepository.js";
import type { IssueWhere } from "../../ogm_types.js";
import type { CreateModerationIssueParams } from "../../services/persistence/moderationIssueWrites.js";
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
  channelImageReportRepository?: ChannelImageReportRepository;
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

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.channelImageReportRepository ?? createChannelImageReportRepository(driver);
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
    const channelData = await repository.findReportedChannel(channelUniqueName);

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
      channelUniqueName: { eq: null }, // Server-scoped
    };

    if (imageType === "ICON") {
      issueWhereClause.relatedChannelIconName = { eq: channelUniqueName };
    } else {
      issueWhereClause.relatedChannelBannerName = { eq: channelUniqueName };
    }

    // Check if an issue already exists for this channel image (server-scoped)
    const existingIssueData = await repository.findPriorChannelImageReport(issueWhereClause);

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

      // relatedChannelIconName/BannerName are scalar-only (no TARGETS_* edge);
      // relatedChannelUniqueName drives the TARGETS_CHANNEL edge. Server-scoped.
      const createParams: CreateModerationIssueParams = {
        issueNumber,
        title: `[Reported channel ${imageTypeLabel}] ${channelDisplayName}`,
        authorModName: loggedInModName,
        channelUniqueName: null, // Server-scoped issue (no HAS_ISSUE edge)
        flaggedServerRuleViolation: true, // Channel image reports always flag server rule violation
        relatedChannelUniqueName: channelUniqueName,
        ...(imageType === "ICON"
          ? { relatedChannelIconName: channelUniqueName }
          : { relatedChannelBannerName: channelUniqueName }),
      };

      try {
        const createResult = await repository.createChannelImageReportIssue(createParams);
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

    // Append the report moderation action via the owned moderation write.
    // Server-scoped: the comment has no Channel connect; text stored verbatim.
    try {
      const updateResult = await repository.appendChannelImageReport({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "report",
            actionDescription: `Reported the channel ${imageTypeLabel}`,
            text: finalCommentText,
            modDisplayName: loggedInModName,
          },
        ],
        isOpen: true, // Reopen the issue if it was closed
        flaggedServerRuleViolation: true, // Channel image reports always flag server rule violation
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
