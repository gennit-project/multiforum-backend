import { createEventReportRepository, type EventReportRepository } from "../../services/persistence/eventReportRepository.js";
import type {
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
import { getFinalCommentText } from "./shared/reportText.js";
import {
  getModerationActionCreateInput,
  getIssueCreateInput,
} from "./reportComment.js";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";

type Args = {
  eventId: string;
  reportText: string;
  selectedForumRules: string[];
  selectedServerRules: string[];
  channelUniqueName: string;
};

type Input = {
  eventReportRepository?: EventReportRepository;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.eventReportRepository ?? createEventReportRepository(driver);
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const {
      eventId,
      reportText,
      selectedForumRules,
      selectedServerRules,
      channelUniqueName,
    } = args;
    if (!eventId) {
      throw new GraphQLError("Event ID is required");
    }
    if (!channelUniqueName) {
      throw new GraphQLError("Channel unique name is required");
    }
    const atLeastOneViolation =
      selectedForumRules?.length > 0 || selectedServerRules?.length > 0;
    if (!atLeastOneViolation) {
      throw new GraphQLError("At least one rule must be selected");
    }

    // Set loggedInUsername to null explicitly if not present
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
    let existingIssueId = "";
    let existingIssueFlaggedServerRuleViolation = false;

    // Check if an issue already exists for the event ID and channel unique name.
    const issueData = await repository.findExisting(channelUniqueName, eventId);

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssueFlaggedServerRuleViolation =
        issueData[0]?.flaggedServerRuleViolation || false;
    }

    const finalCommentText = getFinalCommentText({
      reportText,
      selectedForumRules,
      selectedServerRules,
    });

    // If an issue does NOT already exist, create a new issue.
    if (!existingIssueId) {
      const eventData = await repository.findEvent(eventId);
      const contextText = eventData[0]?.title || "";

      const issueNumber = await getNextIssueNumber(driver, channelUniqueName);
      const issueCreateInput: IssueCreateInput = getIssueCreateInput({
        contextText,
        selectedForumRules,
        selectedServerRules,
        loggedInModName,
        channelUniqueName,
        reportedContentType: "event",
        relatedEventId: eventId,
        issueNumber,
      });
      try {
        const issueData = await repository.createIssue(issueCreateInput);
        const issueId = issueData.issues[0]?.id || null;
        if (!issueId) {
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
      } catch (error) {
        throw new GraphQLError("Error creating issue");
      }
    }

    const moderationActionCreateInput: ModerationActionCreateInput =
      getModerationActionCreateInput({
        text: finalCommentText,
        loggedInModName,
        channelUniqueName,
        actionType: "report",
        actionDescription: "Reported the Event",
        issueId: existingIssueId,
      });

    // Update the issue with the new moderation action.
    const issueUpdateWhere: IssueWhere = {
      id: { eq: existingIssueId },
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
      isOpen: { set: true }, // Reopen the issue if it was closed
      flaggedServerRuleViolation: {
        set:
          existingIssueFlaggedServerRuleViolation ||
          selectedServerRules.length > 0,
      },
    };

    try {
      const issueData = await repository.appendReport(issueUpdateWhere, issueUpdateInput);
      const issueId = issueData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
      return issueData.issues[0];
    } catch (error) {
      throw new GraphQLError("Error updating issue");
    }
  };
};

export default getResolver;
