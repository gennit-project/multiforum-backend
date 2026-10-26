import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import { EventUpdateInput } from "../../src/generated/graphql.js";
import { sendBatchEmails } from "../../services/mail/index.js";
import { createSeriesUpdateNotificationEmail } from "./shared/emailUtils.js";
import { buildEventUpdateNotificationPayload } from "../../services/eventUpdateNotifications.js";
import { createInAppNotificationsForUsers } from "../../services/inAppNotifications.js";
import { executeManagedWrite } from "../../services/neo4jTransactions.js";
import type { GraphQLContext } from "../../types/context.js";
import {createEventSeriesUpdateRepository, type EventSeriesUpdateRepository} from "../../services/persistence/eventSeriesUpdateRepository.js";
import { logger } from "../../logger.js";
import { applyEventChannelChanges } from "./shared/eventChannelChanges.js";

type Input = {
  eventSeriesUpdateRepository?: EventSeriesUpdateRepository;
  driver: Driver;
  dependencies?: {
    sendBatchEmails?: typeof sendBatchEmails;
    createSeriesUpdateNotificationEmail?: typeof createSeriesUpdateNotificationEmail;
    buildEventUpdateNotificationPayload?: typeof buildEventUpdateNotificationPayload;
  };
};

type Args = {
  eventId: string;
  scope: "THIS_ONLY" | "THIS_AND_FUTURE" | "ALL_IN_SERIES";
  eventUpdateInput: EventUpdateInput;
  channelConnections: string[];
  channelDisconnections: string[];
};

type NotifiableUser = {
  username: string;
  Email?: { address: string } | null;
};

// Fields that are shared at the series level (updating these affects series template)
const SERIES_LEVEL_FIELDS = [
  "title",
  "description",
  "locationName",
  "address",
  "virtualEventUrl",
  "placeId",
  "isInPrivateResidence",
  "cost",
  "free",
  "isHostedByOP",
  "coverImageURL",
];

// Fields that are occurrence-specific
const OCCURRENCE_LEVEL_FIELDS = [
  "startTime",
  "endTime",
  "canceled",
  "isAllDay",
];

/**
 * Check which fields in the update are series-level fields
 */
function getSeriesLevelUpdates(
  eventUpdateInput: EventUpdateInput
): Partial<EventUpdateInput> {
  const seriesUpdates: Partial<EventUpdateInput> = {};
  for (const field of SERIES_LEVEL_FIELDS as (keyof EventUpdateInput)[]) {
    if (field in eventUpdateInput) {
      seriesUpdates[field] = eventUpdateInput[field] as never;
    }
  }
  return seriesUpdates;
}

/**
 * Check which fields in the update are occurrence-level fields
 */
function getOccurrenceLevelUpdates(
  eventUpdateInput: EventUpdateInput
): Partial<EventUpdateInput> {
  const occurrenceUpdates: Partial<EventUpdateInput> = {};
  for (const field of OCCURRENCE_LEVEL_FIELDS as (keyof EventUpdateInput)[]) {
    if (field in eventUpdateInput) {
      occurrenceUpdates[field] = eventUpdateInput[field] as never;
    }
  }
  return occurrenceUpdates;
}

const getResolver = (input: Input) => {
  const { driver, dependencies } = input;
  const repository = input.eventSeriesUpdateRepository ?? createEventSeriesUpdateRepository(driver);
  const sendBatchEmailsFn = dependencies?.sendBatchEmails || sendBatchEmails;
  const createSeriesUpdateNotificationEmailFn =
    dependencies?.createSeriesUpdateNotificationEmail ||
    createSeriesUpdateNotificationEmail;
  const buildEventUpdateNotificationPayloadFn =
    dependencies?.buildEventUpdateNotificationPayload ||
    buildEventUpdateNotificationPayload;

  return async (_parent: unknown, args: Args, context: GraphQLContext, _info: GraphQLResolveInfo) => {
    const {
      eventId,
      scope,
      eventUpdateInput,
      channelConnections = [],
      channelDisconnections = [],
    } = args;

    try {
      // Fetch the event and its series relationship with fields needed for notifications
      const existingEvents = await repository.findSnapshot(eventId);

      const existingEvent = existingEvents[0];
      if (!existingEvent) {
        throw new Error("Event not found");
      }

      const eventSeries = existingEvent.EventSeries;
      const seriesLevelUpdates = getSeriesLevelUpdates(eventUpdateInput);
      const occurrenceLevelUpdates = getOccurrenceLevelUpdates(eventUpdateInput);
      const hasSeriesLevelChanges = Object.keys(seriesLevelUpdates).length > 0;

      await executeManagedWrite(driver, async (transaction) => {
        switch (scope) {
        case "THIS_ONLY": {
          // Update only this event
          // If there are series-level changes, set override flags
          const updateWithOverrides: any = { ...eventUpdateInput };

          if (hasSeriesLevelChanges && eventSeries) {
            // Set override flags for each series-level field being changed
            for (const field of Object.keys(seriesLevelUpdates)) {
              const overrideFlag = `overrideSeries${
                field.charAt(0).toUpperCase() + field.slice(1)
              }`;
              // v7 scalar updates take { set: value }.
              updateWithOverrides[overrideFlag] = { set: true };
            }
          }

          await repository.updateOccurrence(eventId, updateWithOverrides, transaction);
          break;
        }

        case "THIS_AND_FUTURE": {
          if (!eventSeries) {
            // No series - just update this event
            await repository.updateOccurrence(eventId, eventUpdateInput, transaction);
          } else {
            // Get all events with occurrenceIndex >= this event's index
            const currentIndex = existingEvent.occurrenceIndex || 0;
            const futureOccurrences = eventSeries.Occurrences.filter(
              (occ: { id: string; occurrenceIndex?: number | null }) => (occ.occurrenceIndex || 0) >= currentIndex
            );

            // Update all future events
            for (const occ of futureOccurrences) {
              await repository.updateOccurrence(occ.id, eventUpdateInput, transaction);
            }

            // If there are series-level changes, also update the series template
            if (hasSeriesLevelChanges) {
              await repository.updateTemplate(eventSeries.id, seriesLevelUpdates, transaction);
            }
          }
          break;
        }

        case "ALL_IN_SERIES": {
          if (!eventSeries) {
            // No series - just update this event
            await repository.updateOccurrence(eventId, eventUpdateInput, transaction);
          } else {
            // Update all events in the series
            for (const occ of eventSeries.Occurrences) {
              await repository.updateOccurrence(occ.id, eventUpdateInput, transaction);
            }

            // Also update the series template for series-level fields
            if (hasSeriesLevelChanges) {
              await repository.updateTemplate(eventSeries.id, seriesLevelUpdates, transaction);
            }
          }
          break;
        }

        default:
          throw new Error(`Invalid scope: ${scope}`);
      }

      // Channel changes are part of the same commit as the occurrence and
      // series updates, preventing partially applied multi-event edits.
      await applyEventChannelChanges({
        transaction,
        eventId,
        channelConnections,
        channelDisconnections,
      });
      });

      // Refetch the updated event with subscriber info for notifications


      const result = await repository.findUpdatedOccurrence(eventId);

      const updatedEvent = result[0];

      // Send notifications for series updates
      const eventUpdateNotification = buildEventUpdateNotificationPayloadFn(
        existingEvent,
        updatedEvent
      );

      if (eventUpdateNotification) {
        const actorUsername = context.user?.username || null;

        // Determine how many events were affected
        let affectedCount = 1;
        if (eventSeries && scope === "THIS_AND_FUTURE") {
          const currentIndex = existingEvent.occurrenceIndex || 0;
          affectedCount = eventSeries.Occurrences.filter(
            (occ: { occurrenceIndex?: number | null }) => (occ.occurrenceIndex || 0) >= currentIndex
          ).length;
        } else if (eventSeries && scope === "ALL_IN_SERIES") {
          affectedCount = eventSeries.Occurrences.length;
        }

        // Get subscribers excluding the actor
        const usersToNotify = (updatedEvent.SubscribedToEventUpdates || []).filter(
          (user: NotifiableUser) => user.username !== actorUsername
        );

        if (usersToNotify.length > 0) {
          const emailContent = createSeriesUpdateNotificationEmailFn(
            updatedEvent.title,
            eventUpdateNotification.summaryLines,
            eventUpdateNotification.eventUrl,
            scope,
            affectedCount,
            eventUpdateNotification.subject
          );

          const emailRecipients = usersToNotify
            .filter((user: NotifiableUser) => user.Email?.address)
            .map((user: NotifiableUser) => ({
              to: user.Email!.address,
              subject: emailContent.subject,
              text: emailContent.plainText,
              html: emailContent.html,
            }));

          if (emailRecipients.length > 0) {
            await sendBatchEmailsFn(emailRecipients);
          }

          const scopeText = scope === "THIS_ONLY"
            ? ""
            : scope === "THIS_AND_FUTURE"
              ? ` (this and ${affectedCount - 1} future)`
              : ` (all ${affectedCount} in series)`;

          await createInAppNotificationsForUsers({
            driver,
            usernames: usersToNotify.map((user: NotifiableUser) => user.username),
            notificationText: `${updatedEvent.title} was updated${scopeText}.`,
            notificationType: "event",
          });
        }
      }

      return updatedEvent;
    } catch (error: unknown) {
      logger.error("Error updating event in series:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update event in series. ${message}`);
    }
  };
};

export default getResolver;
