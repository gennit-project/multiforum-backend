import type { GraphQLResolveInfo } from "graphql";
import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import { resolveCommentIdByShortId } from "../../services/commentShortId.js";
import type { GraphQLContext } from "../../types/context.js";

type Input = {
  driver: Driver;
};

type Args = {
  shortId: string;
};

/**
 * Resolves the global Comment id for a comment shortId (the public URL handle),
 * so the frontend can route a comment permalink and then load the comment
 * through the existing comment queries (which key on id).
 */
const getResolver = (input: Input) => {
  const { driver } = input;
  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ): Promise<string | null> => {
    const { shortId } = args;
    if (!shortId) return null;
    const session = driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      return await resolveCommentIdByShortId(session, shortId);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
