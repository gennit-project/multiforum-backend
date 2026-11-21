import type { GraphQLResolveInfo } from "graphql";
import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import { resolveIdByPerUserNumber, IMAGE_NUMBER } from "../../services/perUserNumber.js";
import type { GraphQLContext } from "../../types/context.js";

type Input = {
  driver: Driver;
};

type Args = {
  username: string;
  imageNumber: number;
};

/**
 * Resolves the global Image id for a per-user image number (the short URL id),
 * so the frontend can route /u/alice/images/12 and then load the image through
 * the existing generated `images` query.
 */
const getResolver = (input: Input) => {
  const { driver } = input;
  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ): Promise<string | null> => {
    const { username, imageNumber } = args;
    if (!username || imageNumber == null) return null;
    const session = driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      return await resolveIdByPerUserNumber(
        session,
        IMAGE_NUMBER,
        username,
        imageNumber
      );
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
