import {createEventModerationRepository, type EventModerationRepository, type EventModerationIssue} from "../../services/persistence/eventModerationRepository.js";
import type { Driver } from "neo4j-driver";
import type {
  EventChannelUpdateInput,
  EventChannelWhere,
} from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { formatModerationActionText } from "../../services/persistence/moderationIssueWrites.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";

type Args = {
  eventId: string;
  channelUniqueName: string;
  explanation: string;
};

type Input = {
  driver: Driver;
  eventModerationRepository?: EventModerationRepository;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.eventModerationRepository ?? createEventModerationRepository(driver);
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const { eventId, explanation, channelUniqueName } = args;

    if (!eventId) {
      throw new GraphQLError("Event ID is required");
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
    if (!channelUniqueName) {
      throw new GraphQLError(
        "Could not find the forum name attached to the event."
      );
    }

    let existingIssueId = "";
    let existingIssue: EventModerationIssue | null = null;

    // Check if an issue already exists for the event ID and channel unique name.
    const issueData = await repository.findRelatedIssues({
        channelUniqueName: { eq: channelUniqueName },
        relatedEventId: { eq: eventId },
      });

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssue = issueData[0];
    } else {
      throw new GraphQLError("Issue not found");
    }

    // Record the un-archive action (closing the issue) via the owned write.
    try {
      const issueData = await repository.recordAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: "un-archive",
            actionDescription: "Un-archived the event",
            text: formatModerationActionText({ text: explanation }),
            modDisplayName: loggedInModName,
            commentChannelUniqueName: channelUniqueName,
          },
        ],
        isOpen: false, // Close the issue; the event is no longer flagged.
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
        actionType: "un-archive",
        actionDescription: "Un-archived the event",
        commentText: explanation,
      });
    } catch (error) {
      throw new GraphQLError("Error updating issue");
    }

    try {
      // Update the eventChannel so that archived=false.
      const eventChannelUpdateWhere: EventChannelWhere = {
        channelUniqueName: { eq: channelUniqueName },
        eventId: { eq: eventId },
      };
      const eventChannelUpdateInput: EventChannelUpdateInput = {
        archived: { set: false },
      };
      const eventUpdateData = await repository.setArchived(eventChannelUpdateWhere, eventChannelUpdateInput);
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
