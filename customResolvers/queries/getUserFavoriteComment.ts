import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";

type Input = {
  driver: Driver;
};

type Args = {
  commentId: string;
};

const getResolver = (input: Input) => {
  const { driver } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { commentId } = args;

    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const loggedInUsername = context.user?.username || null;

    if (!loggedInUsername) {
      return false;
    }

    const session = driver.session();

    try {
      const result = await session.run(
        `
        MATCH (user:User { username: $username })-[:DEFAULT_FAVORITES_COMMENTS]->(comment:Comment { id: $commentId })
        RETURN COUNT(comment) > 0 AS isFavorited
        `,
        {
          username: loggedInUsername,
          commentId,
        }
      );

      const firstRecord = result.records[0];
      return firstRecord ? !!firstRecord.get("isFavorited") : false;
    } catch (error: unknown) {
      console.error("Error checking favorite comment:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to check favorite comment. ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
