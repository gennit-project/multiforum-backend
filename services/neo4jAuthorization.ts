import type { UserDataOnContext } from "../types/context.js";

type Neo4jAuthorizationJwt = Record<string, unknown> & {
  sub?: string;
};

/**
 * Convert the application's verified user identity into the decoded JWT shape
 * consumed by @neo4j/graphql. Auth0's `sub` is not the graph username, so the
 * original provider token cannot be used directly for relationship filters.
 */
export const getNeo4jAuthorizationJwt = (
  user: UserDataOnContext | undefined,
  currentJwt: Record<string, unknown> | undefined = undefined
): Neo4jAuthorizationJwt | undefined => {
  const { sub: _unverifiedSubject, ...serverClaims } = currentJwt ?? {};

  if (!user?.username) {
    return Object.keys(serverClaims).length > 0 ? serverClaims : undefined;
  }

  return { ...serverClaims, sub: user.username };
};
