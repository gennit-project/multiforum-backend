import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import type { EventModel, EventSeriesModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";

type Input = {
  Event: EventModel;
  EventSeries: EventSeriesModel;
  driver: Driver;
};

type Args = {
  eventId: string;
  scope: "THIS_ONLY" | "THIS_AND_FUTURE" | "ALL_IN_SERIES";
};

const getResolver = (input: Input) => {
  const { Event, EventSeries, driver } = input;

  return async (_parent: unknown, args: Args, _context: GraphQLContext, _info: GraphQLResolveInfo) => {
    const { eventId, scope } = args;

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
      let deletedCount = 0;

      switch (scope) {
        case "THIS_ONLY": {
          // Delete only this event
          await Event.delete({
            where: { id: eventId },
          });
          deletedCount = 1;
          break;
        }

        case "THIS_AND_FUTURE": {
          if (!eventSeries) {
            // No series - just delete this event
            await Event.delete({
              where: { id: eventId },
            });
            deletedCount = 1;
          } else {
            // Get all events with occurrenceIndex >= this event's index
            const currentIndex = existingEvent.occurrenceIndex || 0;
            const futureOccurrences = eventSeries.Occurrences.filter(
              (occ: { id: string; occurrenceIndex?: number | null }) => (occ.occurrenceIndex || 0) >= currentIndex
            );

            // Delete all future events
            for (const occ of futureOccurrences) {
              await Event.delete({
                where: { id: occ.id },
              });
              deletedCount++;
            }

            // If all occurrences are deleted, delete the series too
            const remainingOccurrences = eventSeries.Occurrences.length - deletedCount;
            if (remainingOccurrences === 0) {
              await EventSeries.delete({
                where: { id: eventSeries.id },
              });
            }
          }
          break;
        }

        case "ALL_IN_SERIES": {
          if (!eventSeries) {
            // No series - just delete this event
            await Event.delete({
              where: { id: eventId },
            });
            deletedCount = 1;
          } else {
            // Delete all events in the series
            for (const occ of eventSeries.Occurrences) {
              await Event.delete({
                where: { id: occ.id },
              });
              deletedCount++;
            }

            // Delete the series itself
            await EventSeries.delete({
              where: { id: eventSeries.id },
            });
          }
          break;
        }

        default:
          throw new Error(`Invalid scope: ${scope}`);
      }

      return {
        success: true,
        deletedCount,
        message: `Successfully deleted ${deletedCount} event(s)`,
      };
    } catch (error: unknown) {
      logger.error("Error deleting event in series:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete event in series. ${message}`);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
