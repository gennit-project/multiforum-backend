import type { Driver } from "neo4j-driver";

/**
 * The channel discussion list starts from DiscussionChannel.channelUniqueName.
 * The node key on (discussionId, channelUniqueName) cannot seek efficiently
 * when only its second property is supplied, so forum navigation otherwise
 * falls back to scanning every DiscussionChannel node.
 */
export const discussionListIndexStatements = [
  "CREATE RANGE INDEX discussion_channel_by_channel IF NOT EXISTS FOR (dc:DiscussionChannel) ON (dc.channelUniqueName)",
] as const;

export async function ensureDiscussionListIndexes(
  driver: Driver
): Promise<void> {
  const session = driver.session();
  try {
    for (const statement of discussionListIndexStatements) {
      await session.run(statement);
    }
  } finally {
    await session.close();
  }
}
