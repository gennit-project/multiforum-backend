import type { Driver } from "neo4j-driver";

export const FILTER_GROUP_UPLOAD_SELECTION_BACKFILL = `
  MATCH (group:FilterGroup)
  WHERE group.uploadSelection IS NULL
  SET group.uploadSelection = 'MULTIPLE'
  RETURN count(group) AS updated
`;

export async function backfillFilterGroupUploadSelection(
  driver: Driver
): Promise<number> {
  const session = driver.session();
  try {
    const result = await session.run(FILTER_GROUP_UPLOAD_SELECTION_BACKFILL);
    return Number(result.records[0]?.get("updated") ?? 0);
  } finally {
    await session.close();
  }
}
