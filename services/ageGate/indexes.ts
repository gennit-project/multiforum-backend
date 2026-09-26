import type { Driver } from "neo4j-driver";

/**
 * Range indexes on `ageGateTouchedAt`, so the reconcile step that runs before
 * every write commit can find "what this transaction touched" with index
 * seeks instead of label scans (see services/ageGate/reconcile.ts).
 */
const TOUCHED_LABELS = [
  "Discussion",
  "Image",
  "DiscussionChannel",
  "DownloadableFile",
  "FileVersion",
  "Comment",
  "TextVersion",
  "Issue",
] as const;

export const ageGateIndexStatements = TOUCHED_LABELS.map(
  (label) =>
    `CREATE RANGE INDEX age_gate_touched_${label.toLowerCase()} IF NOT EXISTS FOR (n:\`${label}\`) ON (n.ageGateTouchedAt)`
);

export async function ensureAgeGateIndexes(driver: Driver): Promise<void> {
  const session = driver.session();
  try {
    for (const statement of ageGateIndexStatements) {
      await session.run(statement);
    }
  } finally {
    await session.close();
  }
}
