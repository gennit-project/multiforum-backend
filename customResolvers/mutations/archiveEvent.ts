import type {
  IssueModel,
  EventModel,
  IssueCreateInput,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
  EventChannelUpdateInput,
  EventChannelWhere,
  EventChannelModel,
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
  selectedForumRules: string[];
  selectedServerRules: string[];
  reportText: string;
  channelUniqueName: string;
};

type Input = {
  Issue: IssueModel;
  Event: EventModel;
  EventChannel: EventChannelModel;
  driver: any;
};

const getResolver = (input: Input) => {
  const { Issue, Event, EventChannel, driver } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const {
      eventId,
      selectedForumRules,
      selectedServerRules,
      reportText,
      channelUniqueName,
    } = args;

    if (!eventId) {
      throw new GraphQLError("Event ID is required");
    }

    if (!channelUniqueName) {
      throw new GraphQLError("A forum name is required.");
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

    const loggedInModName = context.user?.data?.ModerationProfile?.displayName;
    if (!loggedInModName) {
      throw new GraphQLError(`User ${loggedInUsername} is not a moderator`);
    }

    let existingIssueId = "";
    let existingIssueFlaggedServerRuleViolation = false;
    const eventData = await Event.find({
      where: {
        id: eventId,
      },
      selectionSet: `{
            id
            title
        }`,
    });

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
    } else {
      // If an issue does NOT already exist, create a new issue.
      const eventTitle = eventData[0]?.title || "";

      const issueNumber = await getNextIssueNumber(driver, channelUniqueName);
      const issueCreateInput: IssueCreateInput = getIssueCreateInput({
        contextText: eventTitle,
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

    const finalEventText = getFinalCommentText({
      reportText,
      selectedForumRules,
      selectedServerRules,
    });

    try {
      // Add the activity feed item to the issue that says we archived the event.
      const moderationActionCreateInput: ModerationActionCreateInput =
        getModerationActionCreateInput({
          text: finalEventText,
          loggedInModName,
          channelUniqueName,
          actionType: "archive",
          actionDescription: "Archived the event and closed the issue",
          issueId: existingIssueId,
        });
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
        isOpen: false, // Close the issue; archival is often the final action.
        flaggedServerRuleViolation:
          existingIssueFlaggedServerRuleViolation ||
          selectedServerRules.length > 0,
      };

      const issueData = await Issue.update({
        where: issueUpdateWhere,
        update: issueUpdateInput,
      });
      const issueId = issueData.issues[0]?.id || null;
      if (!issueId) {
        throw new GraphQLError("Error updating issue");
      }
    } catch (error) {
      throw new GraphQLError("Error updating issue");
    }

    try {
      // Update the eventChannel so that archived=true and the issue is linked
      // to the event under RelatedIssues.
      // First we need to find the eventChannel that matches the given event ID
      // and channel unique name.
      const eventChannel = await EventChannel.find({
        where: {
          eventId: eventId,
          channelUniqueName: channelUniqueName,
        },
        selectionSet: `{
            id
        }`,
      });
      const eventChannelId = eventChannel[0]?.id || null;
      if (!eventChannelId) {
        throw new GraphQLError("Error finding eventChannel");
      }
      const eventChannelUpdateWhere: EventChannelWhere = {
        id: eventChannelId,
      };
      const eventChannelUpdateInput: EventChannelUpdateInput = {
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
      const eventChannelUpdateData = await EventChannel.update({
        where: eventChannelUpdateWhere,
        update: eventChannelUpdateInput,
      });
      console.log(
        "result of event channel update data",
        eventChannelUpdateData
      );
      const eventChannelUpdateId =
        eventChannelUpdateData.eventChannels[0]?.id || null;
      if (!eventChannelUpdateId) {
        throw new GraphQLError("Error updating eventChannel");
      }
      return issueData[0];
    } catch (error) {
      console.log("Error creating issue", error);
      return false;
    }
  };
};

export default getResolver;
