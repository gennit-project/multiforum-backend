import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import { createEventChannelQuery } from "../cypher/cypherQueries.js";
import { EventCreateInput } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import { createEventWriteRepository, type EventWriteRepository } from "../../services/persistence/eventWriteRepository.js";
import { stripTags, ownTags } from "../../services/persistence/tagOwnership.js";
import { logger } from "../../logger.js";

type EventCreateInputWithChannels = {
  eventCreateInput: EventCreateInput;
  channelConnections: string[];
};

type Args = {
  input: EventCreateInputWithChannels[];
};

type Input = {
  eventWriteRepository?: EventWriteRepository;
  driver: Driver;
};



/**
 * Function to create events from an input array.
 */
export const createEventsFromInput = async (
  repository: Pick<EventWriteRepository, "createWithinTransaction" | "findCreatedEvent">,
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
        // v7 dropped connectOrCreate for Tags; strip the Tags field and own the
        // HAS_TAG edges (create-if-missing) inside the same write transaction.
        const { cleaned: eventScalars, tagTexts } = stripTags(
          eventCreateInput as Record<string, any>
        );

        const newEventId = await session.executeWrite(async (transaction) => {
          const created = await repository.createWithinTransaction(
            eventScalars as typeof eventCreateInput,
            transaction
          );
          const newEvent = created[0];

          await ownTags(
            (cypher, params) => transaction.run(cypher, params),
            { label: "Event", id: newEvent.id },
            tagTexts
          );

          for (const channelUniqueName of channelConnections) {
            await transaction.run(createEventChannelQuery, {
              eventId: newEvent.id,
              channelUniqueName,
              poster: context.user?.username,
            });
          }

          return newEvent.id;
        });

        // Refetch the event with all related data
        const fetchedEvent = await repository.findCreatedEvent(newEventId);

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
    await session.close();
  }

  return events;
};

/**
 * Main resolver that uses createEventsFromInput
 */
const getResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.eventWriteRepository ?? createEventWriteRepository(driver);

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { input } = args;

    try {
      // Use the extracted function to create events
      const events = await createEventsFromInput(repository, driver, input, context);
      return events;
    } catch (error: unknown) {
      logger.error(error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`An error occurred while creating events: ${message}`);
    }
  };
};

export default getResolver;
