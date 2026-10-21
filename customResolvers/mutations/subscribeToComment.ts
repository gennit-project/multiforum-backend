import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import { createSubscriptionTargetRepository, type SubscriptionTargetRepository } from "../../services/persistence/subscriptionTargetRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

type Args = {
  commentId: string;
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
  ) => {
    const { commentId } = args;
    const { username } = context.user!;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      // Connect user to SubscribedToNotifications
      await session.run(
        `
        MATCH (c:Comment {id: $commentId})
        MATCH (u:User {username: $username})
        MERGE (u)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(c)
        `,
        { commentId, username }
      );

      // Return the updated Comment
      const result = await subscriptionTargets.findComment(commentId);

      return result[0];
    } catch (error: unknown) {
      logger.error("Error subscribing to comment:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to subscribe to comment: ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;