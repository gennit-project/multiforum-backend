import type { ManagedTransaction } from "neo4j-driver";

// Acquire the node lock with a temporary, server-only property before reading
// status. A self-assignment of status can reuse a value cached before waiting
// and overwrite a competitor, so it is not a safe locking operation here.
// Restore the marker's previous value (normally absent) within the transaction.
// https://neo4j.com/docs/operations-manual/current/database-internals/concurrent-data-access/#_lost_updates
export async function lockCampaignStatus(transaction: ManagedTransaction, id: string) {
  const locked = await transaction.run(`
    MATCH (campaign:PluginPipelineCampaign {id: $id})
    WITH campaign, campaign._campaignTransitionLock AS previousLockValue
    SET campaign._campaignTransitionLock = true
    SET campaign._campaignTransitionLock = previousLockValue
    RETURN elementId(campaign) AS identity
  `, { id });
  const identity = locked.records[0]?.get("identity") as string | undefined;
  if (!identity) return null;
  // A node matched before waiting for a lock may have been deleted while we
  // waited. Re-match its identity after the lock instead of trusting that row.
  const result = await transaction.run(`
    MATCH (campaign:PluginPipelineCampaign {id: $id})
    WHERE elementId(campaign) = $identity
    RETURN campaign.status AS status, toString(campaign.updatedAt) AS version
  `, { id, identity });
  const record = result.records[0];
  return record ? {
    status: record.get("status") as string | null,
    version: record.get("version") as string | null,
    identity,
  } : null;
}
