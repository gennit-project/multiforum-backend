import type { GraphQLResolveInfo } from "graphql";
import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import { resolveIdByPerUserNumber, ALBUM_NUMBER } from "../../services/perUserNumber.js";
import type { GraphQLContext } from "../../types/context.js";

type Input = { driver: Driver };
type Args = { username: string; albumNumber: number };

/**
 * Resolves the global Album id for a per-user album number (the short URL id),
 * so the frontend can route /u/alice/albums/3 and then load via the generated
 * `albums` query.
 */
const getResolver = (input: Input) => {
  const { driver } = input;
  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ): Promise<string | null> => {
    const { username, albumNumber } = args;
    if (!username || albumNumber == null) return null;
    const session = driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      return await resolveIdByPerUserNumber(session, ALBUM_NUMBER, username, albumNumber);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
