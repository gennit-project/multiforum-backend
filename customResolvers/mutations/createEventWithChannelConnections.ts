import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import { createEventChannelQuery } from "../cypher/cypherQueries.js";
import { EventCreateInput } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { EventModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";

type EventCreateInputWithChannels = {
  eventCreateInput: EventCreateInput;
  channelConnections: string[];
};

type Args = {
  input: EventCreateInputWithChannels[];
};

type Input = {
  Event: EventModel;
  driver: Driver;
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
  Event: EventModel,
  driver: Driver,
  input: EventCreateInputWithChannels[],
  context: GraphQLContext
): Promise<unknown[]> => {
  if (!input || input.length === 0) {
    throw new Error("Input cannot be empty");
  }

  const session = driver.session();
  const events: unknown[] = [];

  try {
    for (const { eventCreateInput, channelConnections } of input) {
      if (!channelConnections || channelConnections.length === 0) {
        logger.warn("Skipping event creation: No channels provided");
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
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("Constraint validation failed")) {
              logger.warn(`Skipping duplicate EventChannel: ${channelUniqueName}`);
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
      } catch (error: unknown) {
        const err = error as { message?: string; code?: string; stack?: string; neo4jError?: unknown };
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Event creation error details:", {
          message: err.message,
          code: err.code,
          details: err.stack,
          neo4jError: err.neo4jError,
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
        });
        if (message.includes("Constraint validation failed")) {
          logger.warn("Constraint validation details:");
          logger.info('Input:', JSON.stringify(eventCreateInput, null, 2));
          continue;
        }
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Unexpected error during event creation:", message);
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

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { input } = args;

    try {
      // Use the extracted function to create events
      const events = await createEventsFromInput(Event, driver, input, context);
      return events;
    } catch (error: unknown) {
      logger.error(error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`An error occurred while creating events: ${message}`);
    }
  };
};

export default getResolver;
