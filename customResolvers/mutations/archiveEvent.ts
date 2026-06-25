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
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { GraphQLError } from "graphql";
import { getFinalCommentText } from "./shared/reportText.js";
import {
  getModerationActionCreateInput,
  getIssueCreateInput,
} from "./reportComment.js";
import getNextIssueNumber from "./utils/getNextIssueNumber.js";
import { notifyIssueSubscribers } from "../../services/issueNotifications.js";
import { notifyArchivedContentAuthor } from "../../hooks/archivedContentNotificationHook.js";
import { logger } from "../../logger.js";
import {
  checkChannelModPermissions,
  ModChannelPermission,
} from "../../rules/permission/hasChannelModPermission.js";

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
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { Issue, Event, EventChannel, driver } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
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

    const permissionResult = await checkChannelModPermissions({
      channelConnections: [channelUniqueName],
      context,
      permissionCheck: ModChannelPermission.canHideEvent,
    });
    if (permissionResult instanceof Error) {
      throw new GraphQLError(permissionResult.message);
    }

    let existingIssueId = "";
    let existingIssue: { id?: string; issueNumber?: number } | null = null;
    let existingIssueFlaggedServerRuleViolation = false;
    const eventData = await Event.find({
      where: {
        id: eventId,
      },
      selectionSet: `{
            id
            title
            Poster {
              username
            }
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
            issueNumber
            flaggedServerRuleViolation
        }`,
    });

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || "";
      existingIssue = issueData[0] || null;
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
          throw new GraphQLError("Error creating issue");
        }
        existingIssueId = issueId;
        existingIssue = issueData.issues[0];
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
      await notifyIssueSubscribers({
        IssueModel: Issue,
        driver: context.driver,
        issueId,
        actorUsername: loggedInUsername,
        actionType: "archive",
        actionDescription: "Archived the event and closed the issue",
        commentText: finalEventText,
      });
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
      const eventChannelUpdateId =
        eventChannelUpdateData.eventChannels[0]?.id || null;
      if (!eventChannelUpdateId) {
        throw new GraphQLError("Error updating eventChannel");
      }

      // Notify the event poster that their content was archived
      const eventPosterUsername = eventData[0]?.Poster?.username;
      const issueNumber = existingIssue?.issueNumber;

      if (eventPosterUsername && issueNumber) {
        const baseUrl = process.env.FRONTEND_URL || '';
        const contentUrl = `${baseUrl}/forums/${channelUniqueName}/events/${eventId}`;

        await notifyArchivedContentAuthor({
          context: { ogm: context.ogm, driver: context.driver },
          contentType: 'event',
          authorUsername: eventPosterUsername,
          contentUrl,
          channelUniqueName,
          issueNumber,
          moderatorUsername: loggedInUsername,
        });
      }

      return existingIssue;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Error updating eventChannel for archiveEvent:", errorMessage, error);
      throw new GraphQLError(`Failed to update event channel: ${errorMessage}`);
    }
  };
};

export default getResolver;
