import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";
import type { ServerConfigModel } from "../../ogm_types.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import { isSensitiveContentTarget } from "../../services/sensitiveContentTarget.js";
import { logger } from "../../logger.js";

type Input = {
  driver: Driver;
  ServerConfig?: ServerConfigModel;
};

type Args = {
  commentId: string;
};

const getResolver = (input: Input) => {
  const { driver, ServerConfig } = input;
  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { commentId } = args;
    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver,
      ServerConfig,
    });
    if (!canViewSensitiveContent && await isSensitiveContentTarget(driver, { commentId })) {
      return false;
    }

    context.user = await setUserDataOnContext({
      context,
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
      logger.error("Error checking favorite comment:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to check favorite comment. ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
