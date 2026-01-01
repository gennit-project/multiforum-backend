import type {
  Issue,
  IssueModel,
  EventChannelModel,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
  EventChannelUpdateInput,
  EventChannelWhere,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { getModerationActionCreateInput } from "./reportComment.js";

type Args = {
  eventId: string;
  channelUniqueName: string;
  explanation: string;
};

type Input = {
  Issue: IssueModel;
  EventChannel: EventChannelModel;
};

const getResolver = (input: Input) => {
  const { Issue, EventChannel } = input;
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { eventId, explanation, channelUniqueName } = args;

    if (!eventId) {
      throw new GraphQLError("Event ID is required");
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
    if (!channelUniqueName) {
      throw new GraphQLError(
        "Could not find the forum name attached to the event."
      );
    }

    let existingIssueId = "";
    let existingIssue: Issue | null = null;

    // Check if an issue already exists for the event ID and channel unique name.
    const issueData = await Issue.find({
      where: {
        channelUniqueName: channelUniqueName,
        relatedEventId: eventId,
      },
      selectionSet: `{
              id
              issueNumber
              flaggedServerRuleViolation
          }`,
    });

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssue = issueData[0];
    } else {
      throw new GraphQLError("Issue not found");
    }

    const moderationActionCreateInput: ModerationActionCreateInput =
      getModerationActionCreateInput({
        text: explanation,
        loggedInModName,
        channelUniqueName,
        actionType: "un-archive",
        actionDescription: "Un-archived the event",
        issueId: existingIssueId,
      });

    // Update the issue with the new moderation action.
    const issueUpdateWhere: IssueWhere = {
      id: existingIssueId,
    };
    const issueUpdateInput: IssueUpdateInput = {
      isOpen: false, // Close the issue; the event is no longer flagged.
      ActivityFeed: [
        {
          create: [
            {
              node: moderationActionCreateInput,
            },
          ],
        },
      ],
    };

    try {
      const issueData = await Issue.update({
        where: issueUpdateWhere,
        update: issueUpdateInput,
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
    } catch (error) {
      throw new GraphQLError("Error updating issue");
    }

    try {
      // Update the eventChannel so that archived=false.
      const eventChannelUpdateWhere: EventChannelWhere = {
        channelUniqueName: channelUniqueName,
        eventId: eventId,
      };
      const eventChannelUpdateInput: EventChannelUpdateInput = {
        archived: false,
      };
      const eventUpdateData = await EventChannel.update({
        where: eventChannelUpdateWhere,
        update: eventChannelUpdateInput,
      });
      const eventUpdateId =
        eventUpdateData.eventChannels[0]?.id || null;
      if (!eventUpdateId) {
        throw new GraphQLError("Error updating eventChannel");
      }
      return existingIssue;
    } catch (error) {
      throw new GraphQLError("Error updating eventChannel");
    }
  };
};

export default getResolver;
