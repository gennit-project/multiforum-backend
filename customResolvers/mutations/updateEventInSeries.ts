import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import { EventUpdateInput } from "../../src/generated/graphql.js";
import {
  updateEventChannelQuery,
  severConnectionBetweenEventAndChannelQuery,
} from "../cypher/cypherQueries.js";
import { sendBatchEmails } from "../../services/mail/index.js";
import { createSeriesUpdateNotificationEmail } from "./shared/emailUtils.js";
import { buildEventUpdateNotificationPayload } from "../../services/eventUpdateNotifications.js";
import type { GraphQLContext } from "../../types/context.js";
import type { EventModel, EventSeriesModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";

type Input = {
  Event: EventModel;
  EventSeries: EventSeriesModel;
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
  const { Event, EventSeries, driver, dependencies } = input;
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

    const session = driver.session();

    try {
      // Fetch the event and its series relationship with fields needed for notifications
      const existingEvents = await Event.find({
        where: { id: eventId },
        selectionSet: `
          {
            id
            title
            startTime
            endTime
            locationName
            address
            virtualEventUrl
            canceled
            occurrenceIndex
            EventSeries {
              id
              title
              Occurrences {
                id
                occurrenceIndex
              }
            }
          }
        `,
      });

      const existingEvent = existingEvents[0];
      if (!existingEvent) {
        throw new Error("Event not found");
      }

      const eventSeries = existingEvent.EventSeries;
      const seriesLevelUpdates = getSeriesLevelUpdates(eventUpdateInput);
      const occurrenceLevelUpdates = getOccurrenceLevelUpdates(eventUpdateInput);
      const hasSeriesLevelChanges = Object.keys(seriesLevelUpdates).length > 0;

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
              updateWithOverrides[overrideFlag] = true;
            }
          }

          await Event.update({
            where: { id: eventId },
            update: updateWithOverrides,
          });
          break;
        }

        case "THIS_AND_FUTURE": {
          if (!eventSeries) {
            // No series - just update this event
            await Event.update({
              where: { id: eventId },
              update: eventUpdateInput,
            });
          } else {
            // Get all events with occurrenceIndex >= this event's index
            const currentIndex = existingEvent.occurrenceIndex || 0;
            const futureOccurrences = eventSeries.Occurrences.filter(
              (occ: { id: string; occurrenceIndex?: number | null }) => (occ.occurrenceIndex || 0) >= currentIndex
            );

            // Update all future events
            for (const occ of futureOccurrences) {
              await Event.update({
                where: { id: occ.id },
                update: eventUpdateInput,
              });
            }

            // If there are series-level changes, also update the series template
            if (hasSeriesLevelChanges) {
              await EventSeries.update({
                where: { id: eventSeries.id },
                update: seriesLevelUpdates,
              });
            }
          }
          break;
        }

        case "ALL_IN_SERIES": {
          if (!eventSeries) {
            // No series - just update this event
            await Event.update({
              where: { id: eventId },
              update: eventUpdateInput,
            });
          } else {
            // Update all events in the series
            for (const occ of eventSeries.Occurrences) {
              await Event.update({
                where: { id: occ.id },
                update: eventUpdateInput,
              });
            }

            // Also update the series template for series-level fields
            if (hasSeriesLevelChanges) {
              await EventSeries.update({
                where: { id: eventSeries.id },
                update: seriesLevelUpdates,
              });
            }
          }
          break;
        }

        default:
          throw new Error(`Invalid scope: ${scope}`);
      }

      // Handle channel connections/disconnections for the current event
      for (const channelUniqueName of channelConnections) {
        await session.run(updateEventChannelQuery, {
          eventId,
          channelUniqueName,
        });
      }

      for (const channelUniqueName of channelDisconnections) {
        await session.run(severConnectionBetweenEventAndChannelQuery, {
          eventId,
          channelUniqueName,
        });
      }

      // Refetch the updated event with subscriber info for notifications
      const selectionSet = `
        {
          id
          title
          description
          startTime
          startTimeDayOfWeek
          startTimeHourOfDay
          endTime
          locationName
          address
          virtualEventUrl
          canceled
          cost
          isAllDay
          isHostedByOP
          coverImageURL
          occurrenceIndex
          Poster {
            username
          }
          EventSeries {
            id
            title
          }
          EventChannels {
            id
            channelUniqueName
            eventId
            Channel {
              uniqueName
            }
          }
          SubscribedToEventUpdates {
            username
            Email {
              address
            }
          }
          Tags {
            text
          }
          createdAt
          updatedAt
        }
      `;

      const result = await Event.find({
        where: { id: eventId },
        selectionSet,
      });

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

          // Create in-app notifications
          const notificationSession = driver.session();
          try {
            const scopeText = scope === "THIS_ONLY"
              ? ""
              : scope === "THIS_AND_FUTURE"
                ? ` (this and ${affectedCount - 1} future)`
                : ` (all ${affectedCount} in series)`;

            await notificationSession.run(
              `
              UNWIND $usernames AS username
              MATCH (user:User {username: username})
              CREATE (notification:Notification {
                id: randomUUID(),
                createdAt: datetime(),
                read: false,
                text: $notificationText,
                notificationType: 'event'
              })
              CREATE (user)-[:HAS_NOTIFICATION]->(notification)
              `,
              {
                usernames: usersToNotify.map((user: NotifiableUser) => user.username),
                notificationText: `${updatedEvent.title} was updated${scopeText}.`,
              }
            );
          } finally {
            await notificationSession.close();
          }
        }
      }

      return updatedEvent;
    } catch (error: unknown) {
      logger.error("Error updating event in series:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update event in series. ${message}`);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
