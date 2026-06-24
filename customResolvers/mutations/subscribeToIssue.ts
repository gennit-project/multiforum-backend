import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { IssueModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";

type Args = {
  issueId: string;
};

type Input = {
  Issue: IssueModel;
  driver: Driver;
};

const getResolver = (input: Input) => {
  const { Issue, driver } = input;

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const { issueId } = args;
    const { username } = context.user!;

    if (!username) {
      throw new Error("Authentication required");
    }

    const session = driver.session();

    try {
      // Connect user to SubscribedToNotifications
      await session.run(
        `
        MATCH (i:Issue {id: $issueId})
        MATCH (u:User {username: $username})
        MERGE (u)-[:SUBSCRIBED_TO_ISSUE]->(i)
        `,
        { issueId, username }
      );

      // Return the updated Issue
      const result = await Issue.find({
        where: { id: issueId },
        selectionSet: `{
          id
          issueNumber
          title
          channelUniqueName
          createdAt
          SubscribedToNotifications {
            username
          }
        }`
      });

      return result[0];
    } catch (error: unknown) {
      console.error("Error subscribing to issue:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to subscribe to issue: ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
