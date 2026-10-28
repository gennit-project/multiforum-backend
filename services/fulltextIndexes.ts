import type { Driver } from "neo4j-driver";

/**
 * v7 (campaign #284): @neo4j/graphql 7's assertIndexesAndConstraints only
 * CHECKS for the @fulltext indexes the schema declares — unlike v5, it no longer
 * creates them (it takes no `{ options: { create: true } }`). So on a fresh
 * database the server would crash at startup with "Missing @fulltext index ...".
 * We create them ourselves (idempotently) before ensureSchemaConstraints runs,
 * mirroring the @fulltext directives in typeDefs.ts. Keep this list in sync with
 * those directives.
 */
const fulltextIndexes: ReadonlyArray<{
  name: string;
  label: string;
  properties: string[];
}> = [
  { name: "wikiPageFulltext", label: "WikiPage", properties: ["title", "body"] },
  { name: "channelFulltext", label: "Channel", properties: ["uniqueName", "description"] },
  { name: "discussionFulltext", label: "Discussion", properties: ["title", "body"] },
  { name: "issueFulltext", label: "Issue", properties: ["title", "body"] },
];

export const fulltextIndexStatements = fulltextIndexes.map(({ name, label, properties }) => {
  const eachProps = properties.map((property) => `n.\`${property}\``).join(", ");
  return `CREATE FULLTEXT INDEX ${name} IF NOT EXISTS FOR (n:\`${label}\`) ON EACH [${eachProps}]`;
});

export async function ensureFulltextIndexes(driver: Driver): Promise<void> {
  const session = driver.session();
  try {
    for (const statement of fulltextIndexStatements) {
      await session.run(statement);
    }
  } finally {
    await session.close();
  }
}
