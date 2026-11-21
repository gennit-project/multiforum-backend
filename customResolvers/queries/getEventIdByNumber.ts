import type { GraphQLResolveInfo } from "graphql";
import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import { resolveEventIdByNumber } from "../../services/eventRouteLookup.js";
import type { GraphQLContext } from "../../types/context.js";

type Input = {
  driver: Driver;
};

type Args = {
  channelUniqueName: string;
  eventNumber: number;
};

/**
 * Resolves the global Event id for a per-forum event number (the short URL id),
 * so the frontend can route /forums/cats/events/7-... and then load the event
 * through the existing generated `events` query and `getEventComments`.
 */
const getResolver = (input: Input) => {
  const { driver } = input;
  return async (
    _parent: unknown,
    args: Args,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ): Promise<string | null> => {
    const { channelUniqueName, eventNumber } = args;
    if (!channelUniqueName || eventNumber == null) return null;
    const session = driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      return await resolveEventIdByNumber(session, channelUniqueName, eventNumber);
    } finally {
      await session.close();
    }
  };
};

export default getResolver;
