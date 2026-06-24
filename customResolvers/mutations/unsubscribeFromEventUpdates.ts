import type { Driver } from "neo4j-driver";
import type { EventModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";

type Args = {
  eventId: string;
};

type Input = {
  Event: EventModel;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { Event, driver } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext) => {
    const { eventId } = args;
    const { username } = context.user!;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      await session.run(
        `
        MATCH (e:Event {id: $eventId})
        MATCH (u:User {username: $username})
        OPTIONAL MATCH (u)-[r:SUBSCRIBED_TO_EVENT_UPDATES]->(e)
        DELETE r
        `,
        { eventId, username }
      );

      const result = await Event.find({
        where: { id: eventId },
        selectionSet: `{
          id
          title
          createdAt
          SubscribedToEventUpdates {
            username
          }
        }`,
      });

      return result[0];
    } catch (error: unknown) {
      console.error("Error unsubscribing from event updates:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to unsubscribe from event updates: ${message}`
      );
    } finally {
      session.close();
    }
  };
};

export default getResolver;
