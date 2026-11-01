import type { Driver } from "neo4j-driver";
import { createSubscriptionTargetRepository, type SubscriptionTargetRepository, type EventUpdatesSubscriptionTarget } from "../../services/persistence/subscriptionTargetRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

type Args = {
  eventId: string;
};

type Input = {
  subscriptionTargetRepository?: SubscriptionTargetRepository;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  const subscriptionTargets = input.subscriptionTargetRepository ?? createSubscriptionTargetRepository(driver);

  return async (parent: unknown, args: Args, context: GraphQLContext): Promise<EventUpdatesSubscriptionTarget | undefined> => {
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

      const result = await subscriptionTargets.findEventUpdates(eventId);

      return result[0];
    } catch (error: unknown) {
      logger.error("Error unsubscribing from event updates:", error);
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
