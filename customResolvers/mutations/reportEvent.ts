import type {
  IssueModel,
  EventModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { getFinalCommentText } from "./reportDiscussion.js";
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
  Issue: IssueModel;
  Event: EventModel;
  driver: any;
};

const getResolver = (input: Input) => {
  const { Issue, Event, driver } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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
      getPermissionInfo: false,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      throw new GraphQLError("User must be logged in");
    }
    const loggedInModName = context.user.data.ModerationProfile.displayName;
    if (!loggedInModName) {
      throw new GraphQLError(`User ${loggedInUsername} is not a moderator`);
    }
    let existingIssueId = "";
    let existingIssueFlaggedServerRuleViolation = false;

    // Check if an issue already exists for the event ID and channel unique name.
    const issueData = await Issue.find({
      where: {
        channelUniqueName: channelUniqueName,
        relatedEventId: eventId,
      },
      selectionSet: `{
            id
            flaggedServerRuleViolation
        }`,
    });

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
      const eventData = await Event.find({
        where: {
          id: eventId,
        },
        selectionSet: `{
                        id
                        title            
                    }`,
      });
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
        const issueData = await Issue.create({
          input: [issueCreateInput],
        });
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
        selectedServerRules.length > 0,
    };

    try {
      const issueData = await Issue.update({
        where: issueUpdateWhere,
        update: issueUpdateInput,
      });
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
