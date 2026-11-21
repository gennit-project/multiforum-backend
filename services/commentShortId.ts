/**
 * Short, URL-friendly identifier for comments, so comment permalinks read
 * /forums/cats/discussions/42-.../comments/4f3a9b2e1c7d instead of a full UUID.
 *
 * Comments are threaded, paginated and re-sorted, so a stable per-thread
 * sequence number is semantically awkward; a short random id gives a compact
 * permalink without ordering semantics. The internal `id` is kept for every
 * relationship — `shortId` is only the public URL handle.
 */

/**
 * Cypher expression that mints a shortId: 12 hex chars from a random UUID
 * (16^12 ≈ 2.8e14 of space; the Comment.shortId uniqueness constraint is the
 * safety net for the astronomically rare collision). Shared by every comment
 * create path and the backfill so they stay identical. Interpolated into Cypher
 * the same way the existing `randomUUID()` calls are — not a user value.
 */
export const COMMENT_SHORT_ID_CYPHER =
  "substring(replace(randomUUID(), '-', ''), 0, 12)";

type CypherRunner = {
  run: (
    cypher: string,
    params: Record<string, unknown>
  ) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
};

const COMMENT_ID_BY_SHORT_ID = `
  MATCH (c:Comment {shortId: $shortId})
  RETURN c.id AS id
  LIMIT 1
`;

/**
 * Translate a comment shortId (the public URL handle) into the global Comment
 * id that every comment query keys on. Returns null when no comment carries
 * that shortId.
 */
export const resolveCommentIdByShortId = async (
  runner: CypherRunner,
  shortId: string
): Promise<string | null> => {
  const result = await runner.run(COMMENT_ID_BY_SHORT_ID, { shortId });
  const raw = result.records[0]?.get("id");
  return typeof raw === "string" ? raw : null;
};
