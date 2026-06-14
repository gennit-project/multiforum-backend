import { EventUpdateInput } from "../../src/generated/graphql.js";
import {
  updateEventChannelQuery,
  severConnectionBetweenEventAndChannelQuery,
} from "../cypher/cypherQueries.js";

type Input = {
  Event: any;
  EventSeries: any;
  driver: any;
};

type Args = {
  eventId: string;
  scope: "THIS_ONLY" | "THIS_AND_FUTURE" | "ALL_IN_SERIES";
  eventUpdateInput: EventUpdateInput;
  channelConnections: string[];
  channelDisconnections: string[];
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
  for (const field of SERIES_LEVEL_FIELDS) {
    if (field in eventUpdateInput) {
      (seriesUpdates as any)[field] = (eventUpdateInput as any)[field];
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
  for (const field of OCCURRENCE_LEVEL_FIELDS) {
    if (field in eventUpdateInput) {
      (occurrenceUpdates as any)[field] = (eventUpdateInput as any)[field];
    }
  }
  return occurrenceUpdates;
}

const getResolver = (input: Input) => {
  const { Event, EventSeries, driver } = input;

  return async (_parent: any, args: Args, _context: any, _info: any) => {
    const {
      eventId,
      scope,
      eventUpdateInput,
      channelConnections = [],
      channelDisconnections = [],
    } = args;

    const session = driver.session();

    try {
      // Fetch the event and its series relationship
      const existingEvents = await Event.find({
        where: { id: eventId },
        selectionSet: `
          {
            id
            title
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
              (occ: any) => (occ.occurrenceIndex || 0) >= currentIndex
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

      // Refetch the updated event
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

      return result[0];
    } catch (error: any) {
      console.error("Error updating event in series:", error);
      throw new Error(`Failed to update event in series. ${error.message}`);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
