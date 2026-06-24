import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { EventModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

type Args = {
  eventId: string;
};

type Input = {
  Event: EventModel;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { Event, driver } = input;

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const { eventId } = args;
    const { username } = context.user!;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      // Connect user to SubscribedToNotifications
      await session.run(
        `
        MATCH (e:Event {id: $eventId})
        MATCH (u:User {username: $username})
        MERGE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(e)
        `,
        { eventId, username }
      );

      // Return the updated Event
      const result = await Event.find({
        where: { id: eventId },
        selectionSet: `{
          id
          title
          description
          createdAt
          SubscribedToNotifications {
            username
          }
        }`
      });

      return result[0];
    } catch (error: unknown) {
      logger.error("Error subscribing to event:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to subscribe to event: ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;