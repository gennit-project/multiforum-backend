import type { Driver } from "neo4j-driver";

export type DeletedParent =
  | { kind: "discussion"; id: string }
  | { kind: "event"; id: string };

/**
 * Remove malformed connector nodes from the active graph without destroying
 * their properties or relationships. This is intentionally idempotent.
 */
export async function quarantineConnectorsForDeletedParent(
  driver: Driver,
  parent: DeletedParent
): Promise<number> {
  return quarantineConnectorsForDeletedParents(driver, [parent]);
}

export async function quarantineConnectorsForDeletedParents(
  driver: Driver,
  parents: DeletedParent[]
): Promise<number> {
  if (parents.length === 0) return 0;
  const session = driver.session();
  try {
    return await session.executeWrite(async (tx) => {
      let quarantined = 0;
      for (const kind of ["discussion", "event"] as const) {
        const parentIds = parents
          .filter((parent) => parent.kind === kind)
          .map((parent) => parent.id);
        if (parentIds.length === 0) continue;

        const isDiscussion = kind === "discussion";
        const activeLabel = isDiscussion ? "DiscussionChannel" : "EventChannel";
        const quarantineLabel = isDiscussion
          ? "QuarantinedDiscussionChannel"
          : "QuarantinedEventChannel";
        const contentLabel = isDiscussion ? "Discussion" : "Event";
        const idProperty = isDiscussion ? "discussionId" : "eventId";
        const result = await tx.run(
          `
          UNWIND $parentIds AS parentId
          MATCH (entry:${activeLabel} {${idProperty}: parentId})
          WHERE count { (entry)-[:POSTED_IN_CHANNEL]->(:${contentLabel}) } = 0
          SET entry:${quarantineLabel},
              entry.quarantinedAt = datetime(),
              entry.quarantineReason = 'parent deleted',
              entry.quarantineSource = 'parent-delete-guard-v1'
          REMOVE entry:${activeLabel}
          RETURN count(entry) AS quarantined
          `,
          { parentIds }
        );
        quarantined += result.records[0]?.get("quarantined")?.toNumber?.() ?? 0;
      }
      return quarantined;
    });
  } finally {
    await session.close();
  }
}
