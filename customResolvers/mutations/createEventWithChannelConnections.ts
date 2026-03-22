import { createEventChannelQuery } from "../cypher/cypherQueries.js";
import { EventCreateInput } from "../../src/generated/graphql.js";

type EventCreateInputWithChannels = {
  eventCreateInput: EventCreateInput;
  channelConnections: string[];
};

type Args = {
  input: EventCreateInputWithChannels[];
};

type Input = {
  Event: any;
  driver: any;
};

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
    startTimeDayOfWeek
    canceled
    cost
    isAllDay
    isHostedByOP
    coverImageURL
    Poster {
      username
    }
    EventChannels {
      id
      createdAt
      channelUniqueName
      eventId
      archived
      Channel {
        uniqueName
      }
      Event {
        id
      }
    }
    SubscribedToNotifications {
      username
    }
    SubscribedToEventUpdates {
      username
    }
    createdAt
    updatedAt
    Tags {
      text
    }
  }
`;

/**
 * Function to create events from an input array.
 */
export const createEventsFromInput = async (
  Event: any,
  driver: any,
  input: EventCreateInputWithChannels[],
  context: any
): Promise<any[]> => {
  if (!input || input.length === 0) {
    throw new Error("Input cannot be empty");
  }

  const session = driver.session();
  const events: any[] = [];

  try {
    for (const { eventCreateInput, channelConnections } of input) {
      if (!channelConnections || channelConnections.length === 0) {
        console.warn("Skipping event creation: No channels provided");
        continue;
      }

      try {
        const response = await Event.create({
          input: [eventCreateInput],
          selectionSet: `{ events ${selectionSet} }`,
        });

        const newEvent = response.events[0];
        const newEventId = newEvent.id;

        // Link the event to channels
        for (const channelUniqueName of channelConnections) {
          try {
            await session.run(createEventChannelQuery, {
              eventId: newEventId,
              channelUniqueName,
              poster: context.user?.username,
            });
          } catch (error: any) {
            if (error.message.includes("Constraint validation failed")) {
              console.warn(`Skipping duplicate EventChannel: ${channelUniqueName}`);
              continue;
            } else {
              throw error;
            }
          }
        }

        // Refetch the event with all related data
        const fetchedEvent = await Event.find({
          where: {
            id: newEventId,
          },
          selectionSet,
        });

        events.push(fetchedEvent[0]);
      } catch (error: any) {
        console.warn("Event creation error details:", {
          message: error.message,
          code: error.code,
          details: error.stack,
          neo4jError: error.neo4jError,
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
        });
        if (error.message.includes("Constraint validation failed")) {
          console.warn("Constraint validation details:");
          console.log('Input:', JSON.stringify(eventCreateInput, null, 2));
          continue;
        }
      }
    }
  } catch (error: any) {
    console.error("Unexpected error during event creation:", error.message);
  } finally {
    session.close();
  }

  return events;
};

/**
 * Main resolver that uses createEventsFromInput
 */
const getResolver = (input: Input) => {
  const { Event, driver } = input;

  return async (parent: any, args: Args, context: any, info: any) => {
    const { input } = args;

    try {
      // Use the extracted function to create events
      const events = await createEventsFromInput(Event, driver, input, context);
      return events;
    } catch (error: any) {
      console.error(error);
      throw new Error(`An error occurred while creating events: ${error.message}`);
    }
  };
};

export default getResolver;
