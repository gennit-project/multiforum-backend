import type { Driver } from "neo4j-driver";

// FAMILY-3 / v7 (campaign #284). A revision connects an existing Author
// (TextVersion.Author = AUTHORED_VERSION, direction IN: (:User)-[:AUTHORED_VERSION]->(:TextVersion)),
// a to-one whose nested connect v7 removed. The discussion/wiki/event revision
// repositories and the version-history hooks all create a TextVersion with that
// author edge, so the owned write lives here.
export async function createTextVersion(
  driver: Driver,
  scalars: Record<string, unknown>,
  authorUsername: string | null
): Promise<{ textVersions: Array<{ id: string }> }> {
  const clean = Object.fromEntries(Object.entries(scalars).filter(([, v]) => v !== undefined));
  const result = await driver.executeQuery(
    `
 CREATE (tv:TextVersion)
 SET tv += $scalars
 SET tv.id = randomUUID(), tv.createdAt = datetime(), tv.ageGateTouchedAt = datetime()
 WITH tv
 OPTIONAL MATCH (author:User {username: $authorUsername})
 FOREACH (_ IN CASE WHEN author IS NULL THEN [] ELSE [1] END |
  MERGE (author)-[:AUTHORED_VERSION]->(tv)
 )
 RETURN tv.id AS id
`,
    { scalars: clean, authorUsername }
  );
  return { textVersions: result.records.map((r) => ({ id: String(r.get("id")) })) };
}

// Pull the Author connect username out of a TextVersionCreateInput-shaped object,
// returning it with Author removed so the rest is the scalar map.
export function splitTextVersionInput(input: unknown): {
  scalars: Record<string, unknown>;
  authorUsername: string | null;
} {
  const { Author, ...scalars } = (input as Record<string, any>) ?? {};
  return { scalars, authorUsername: Author?.connect?.where?.node?.username ?? null };
}
