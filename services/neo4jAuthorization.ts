import type {
  Neo4jAuthorizationJwt,
  UserDataOnContext,
} from "../types/context.js";

/**
 * Convert the application's verified user identity into the decoded JWT shape
 * consumed by @neo4j/graphql. Auth0's `sub` is not the graph username, so the
 * original provider token cannot be used directly for relationship filters.
 */
export const getNeo4jAuthorizationJwt = (
  user: UserDataOnContext | undefined
): Neo4jAuthorizationJwt | undefined => {
  if (!user?.username) {
    return undefined;
  }

  return { sub: user.username };
};
