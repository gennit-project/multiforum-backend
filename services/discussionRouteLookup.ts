import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";

/**
 * Minimal shape shared by a neo4j-driver Session and a managed Transaction:
 * both expose `.run(cypher, params)`. Lets the route lookup run either on its
 * own session or inside a caller's existing read transaction.
 */
type CypherRunner = {
  run: (
    cypher: string,
    params: Record<string, unknown>
  ) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
};

const DISCUSSION_ID_BY_NUMBER = `
  MATCH (dc:DiscussionChannel {channelUniqueName: $channelUniqueName, discussionNumber: $discussionNumber})
  RETURN dc.discussionId AS discussionId
  LIMIT 1
`;

/**
 * Translate a per-forum discussion number (the short URL id) into the global
 * Discussion id that every downstream query keys on. Returns null when no
 * discussion carries that number in the channel.
 */
export const resolveDiscussionIdByNumber = async (
  runner: CypherRunner,
  channelUniqueName: string,
  discussionNumber: number
): Promise<string | null> => {
  const result = await runner.run(DISCUSSION_ID_BY_NUMBER, {
    channelUniqueName,
    discussionNumber: neo4j.int(discussionNumber),
  });
  const raw = result.records[0]?.get("discussionId");
  return typeof raw === "string" ? raw : null;
};

/**
 * Resolve the effective discussion id for a read resolver that accepts either a
 * global `discussionId` or a per-forum `discussionNumber`. An explicit
 * `discussionId` wins so the pre-migration frontend contract keeps working;
 * otherwise the number is translated. Returns null when neither is usable.
 */
export const resolveDiscussionIdArg = async (
  runner: CypherRunner,
  args: {
    channelUniqueName: string;
    discussionId?: string | null;
    discussionNumber?: number | null;
  }
): Promise<string | null> => {
  if (args.discussionId) return args.discussionId;
  if (args.discussionNumber != null) {
    return resolveDiscussionIdByNumber(
      runner,
      args.channelUniqueName,
      args.discussionNumber
    );
  }
  return null;
};

/**
 * Same as resolveDiscussionIdArg, but opens (and closes) its own short-lived
 * read session. Use from resolvers that need the id before their main session
 * exists, e.g. ahead of an early-returning content-visibility check.
 */
export const resolveDiscussionIdArgWithDriver = async (
  driver: Driver,
  args: {
    channelUniqueName: string;
    discussionId?: string | null;
    discussionNumber?: number | null;
  }
): Promise<string | null> => {
  if (args.discussionId) return args.discussionId;
  if (args.discussionNumber == null) return null;
  const session = driver.session();
  try {
    return await resolveDiscussionIdByNumber(
      session,
      args.channelUniqueName,
      args.discussionNumber
    );
  } finally {
    await session.close();
  }
};
