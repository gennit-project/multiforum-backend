import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import { createSubscriptionTargetRepository, type SubscriptionTargetRepository, type EventSubscriptionTarget } from "../../services/persistence/subscriptionTargetRepository.js";
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

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ): Promise<EventSubscriptionTarget | undefined> => {
    const { eventId } = args;
    const { username } = context.user!;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      // Disconnect user from SubscribedToNotifications
      await session.run(
        `
        MATCH (e:Event {id: $eventId})
        MATCH (u:User {username: $username})
        OPTIONAL MATCH (u)-[r:SUBSCRIBED_TO_NOTIFICATIONS]->(e)
        DELETE r
        `,
        { eventId, username }
      );

      // Return the updated Event
      const result = await subscriptionTargets.findEvent(eventId);

      return result[0];
    } catch (error: unknown) {
      logger.error("Error unsubscribing from event:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to unsubscribe from event: ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;