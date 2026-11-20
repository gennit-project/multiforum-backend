import neo4j, { type Driver } from "neo4j-driver";

/**
 * Per-user sequential numbers that give library items short, human-friendly
 * URLs (/u/alice/images/12, /u/alice/albums/3, /u/alice/collections/5-nature).
 * Mirrors the per-forum ChannelDiscussionCounter / ChannelEventCounter pattern,
 * but scoped to a user instead of a channel. The internal `id` is kept for every
 * relationship; the number is only the public URL handle.
 *
 * Label/field names come from the fixed specs below (never user input), so they
 * are safe to interpolate into Cypher the same way the existing counter queries
 * build their statements.
 */
export type PerUserNumberSpec = {
  counterLabel: string; // e.g. "UserImageCounter"
  targetLabel: string; // e.g. "Image"
  scopeField: string; // owner-username property, e.g. "uploadedByUsername"
  numberField: string; // sequential number property, e.g. "imageNumber"
};

export const IMAGE_NUMBER: PerUserNumberSpec = {
  counterLabel: "UserImageCounter",
  targetLabel: "Image",
  scopeField: "uploadedByUsername",
  numberField: "imageNumber",
};

export const ALBUM_NUMBER: PerUserNumberSpec = {
  counterLabel: "UserAlbumCounter",
  targetLabel: "Album",
  scopeField: "ownerUsername",
  numberField: "albumNumber",
};

export const COLLECTION_NUMBER: PerUserNumberSpec = {
  counterLabel: "UserCollectionCounter",
  targetLabel: "Collection",
  scopeField: "ownerUsername",
  numberField: "collectionNumber",
};

/**
 * A unit CALL subquery (no RETURN) that allocates the next per-user number onto
 * `nodeVar` when its owner field is set and it has no number yet. Self-heals from
 * the current max so the counter survives manual inserts and backfills. Being a
 * unit subquery, it never multiplies or drops the outer row. Caller must have
 * `nodeVar` in scope and keep it in scope afterward (e.g. `WITH ${nodeVar}` on
 * both sides).
 */
export const allocatePerUserNumberSnippet = (
  nodeVar: string,
  spec: PerUserNumberSpec
): string => `
CALL {
  WITH ${nodeVar}
  WITH ${nodeVar} WHERE ${nodeVar}.${spec.scopeField} IS NOT NULL AND ${nodeVar}.${spec.numberField} IS NULL
  MERGE (counter:${spec.counterLabel} {username: ${nodeVar}.${spec.scopeField}})
    ON CREATE SET counter.current = 0
  WITH ${nodeVar}, counter
  OPTIONAL MATCH (existing:${spec.targetLabel} {${spec.scopeField}: counter.username})
  WITH ${nodeVar}, counter, coalesce(max(existing.${spec.numberField}), 0) AS maxExisting
  SET counter.current = (CASE WHEN counter.current < maxExisting THEN maxExisting ELSE counter.current END) + 1
  SET ${nodeVar}.${spec.numberField} = counter.current
}`;

const numberValue = (value: unknown): number =>
  neo4j.isInt(value) ? (value as neo4j.Integer).toNumber() : Number(value ?? 0);

/**
 * Backfill per-user numbers for a library type: for every owner, number the
 * nodes that lack one in creation order, continuing past any already assigned,
 * then seed the counter. Idempotent (only touches nodes where the number IS
 * NULL and the owner IS NOT NULL). Must run before the (owner, number) uniqueness
 * constraint is created.
 */
export const backfillPerUserNumbers = async (
  driver: Driver,
  spec: PerUserNumberSpec
): Promise<{ ownersUpdated: number; nodesNumbered: number }> => {
  const query = `
    MATCH (n:${spec.targetLabel})
    WHERE n.${spec.scopeField} IS NOT NULL AND n.${spec.numberField} IS NULL
    WITH n.${spec.scopeField} AS owner, n
    ORDER BY n.createdAt ASC, n.id ASC
    WITH owner, collect(n) AS toAssign
    CALL {
      WITH owner
      OPTIONAL MATCH (numbered:${spec.targetLabel} {${spec.scopeField}: owner})
      WHERE numbered.${spec.numberField} IS NOT NULL
      RETURN coalesce(max(numbered.${spec.numberField}), 0) AS startFrom
    }
    UNWIND range(0, size(toAssign) - 1) AS idx
    WITH owner, toAssign, startFrom, idx, toAssign[idx] AS n
    SET n.${spec.numberField} = startFrom + idx + 1
    WITH owner, size(toAssign) AS assigned, startFrom + size(toAssign) AS newMax
    WITH DISTINCT owner, assigned, newMax
    MERGE (counter:${spec.counterLabel} {username: owner})
    SET counter.current = CASE WHEN coalesce(counter.current, 0) < newMax THEN newMax ELSE counter.current END
    RETURN count(*) AS ownersUpdated, coalesce(sum(assigned), 0) AS nodesNumbered
  `;
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.executeWrite((tx) => tx.run(query));
    const record = result.records[0];
    return {
      ownersUpdated: numberValue(record?.get("ownersUpdated")),
      nodesNumbered: numberValue(record?.get("nodesNumbered")),
    };
  } finally {
    await session.close();
  }
};

type CypherRunner = {
  run: (
    cypher: string,
    params: Record<string, unknown>
  ) => Promise<{ records: Array<{ get: (key: string) => unknown }> }>;
};

/**
 * Translate a per-user number (the short URL id) into the global node id that
 * the generated `images`/`albums`/`collections` queries key on. Returns null
 * when no node carries that number for the owner.
 */
export const resolveIdByPerUserNumber = async (
  runner: CypherRunner,
  spec: PerUserNumberSpec,
  username: string,
  value: number
): Promise<string | null> => {
  const result = await runner.run(
    `MATCH (n:${spec.targetLabel} {${spec.scopeField}: $username, ${spec.numberField}: $value}) RETURN n.id AS id LIMIT 1`,
    { username, value: neo4j.int(value) }
  );
  const raw = result.records[0]?.get("id");
  return typeof raw === "string" ? raw : null;
};
