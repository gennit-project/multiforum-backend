import type { Transaction } from 'neo4j-driver';
import type { ScratchpadSuperVoter } from '../../customResolvers/contracts/scratchpadSuperVoters.js';

/** Read through the caller's still-open write transaction. Stored usernames are
 * raw source values, not the validated viewer parameter or completed Strings.
 */
export async function readScratchpadSuperVoters(
  transaction: Pick<Transaction,'run'>,
  sourceType: 'comment' | 'discussion',
  sourceId: string,
): Promise<ScratchpadSuperVoter[]> {
  const query = sourceType === 'comment'
    ? `MATCH (u:User)-[:SUPER_UPVOTED_COMMENT]->(:Comment { id: $sourceId })
       RETURN collect({ username: u.username }) AS users`
    : `MATCH (u:User)-[:SUPER_UPVOTED_DISCUSSION]->(:DiscussionChannel { id: $sourceId })
       RETURN collect({ username: u.username }) AS users`;
  const result = await transaction.run<{users:ScratchpadSuperVoter[]}>(query,{sourceId});
  return result.records[0]?.get('users') || [];
}
