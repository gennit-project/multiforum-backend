import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import { createSubscriptionTargetRepository, type SubscriptionTargetRepository, type IssueSubscriptionTarget } from "../../services/persistence/subscriptionTargetRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

type Args = {
  issueId: string;
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
  ): Promise<IssueSubscriptionTarget | undefined> => {
    const { issueId } = args;
    const { username } = context.user!;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      // Disconnect user from SubscribedToNotifications
      await session.run(
        `
        MATCH (i:Issue {id: $issueId})
        MATCH (u:User {username: $username})
        OPTIONAL MATCH (u)-[r:SUBSCRIBED_TO_ISSUE]->(i)
        DELETE r
        `,
        { issueId, username }
      );

      // Return the updated Issue
      const result = await subscriptionTargets.findIssue(issueId);

      return result[0];
    } catch (error: unknown) {
      logger.error("Error unsubscribing from issue:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to unsubscribe from issue: ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
