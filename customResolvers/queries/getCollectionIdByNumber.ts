import type { GraphQLResolveInfo } from "graphql";
import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import { resolveIdByPerUserNumber, COLLECTION_NUMBER } from "../../services/perUserNumber.js";
import type { GraphQLContext } from "../../types/context.js";

type Input = { driver: Driver };
type Args = { username: string; collectionNumber: number };

/**
 * Resolves the global Collection id for a per-user collection number (the short
 * URL id), so the frontend can route /u/alice/collections/5-nature and then load
 * via the generated `collections` query.
 */
const getResolver = (input: Input) => {
  const { driver } = input;
  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ): Promise<string | null> => {
    const { username, collectionNumber } = args;
    if (!username || collectionNumber == null) return null;
    const session = driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      return await resolveIdByPerUserNumber(session, COLLECTION_NUMBER, username, collectionNumber);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
