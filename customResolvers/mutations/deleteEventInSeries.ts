type Input = {
  Event: any;
  EventSeries: any;
  driver: any;
};

type Args = {
  eventId: string;
  scope: "THIS_ONLY" | "THIS_AND_FUTURE" | "ALL_IN_SERIES";
};

const getResolver = (input: Input) => {
  const { Event, EventSeries, driver } = input;

  return async (_parent: any, args: Args, _context: any, _info: any) => {
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
              (occ: any) => (occ.occurrenceIndex || 0) >= currentIndex
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
    } catch (error: any) {
      console.error("Error deleting event in series:", error);
      throw new Error(`Failed to delete event in series. ${error.message}`);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
