import type {CampaignRow} from '../../services/persistence/campaignServiceRepository.js';
import {rememberCanonicalSource} from '../../services/canonicalSourceFields.js';

// Adapt only the fixed, alias-free generated campaign document. Dynamic generated
// response-key maps must not pass through this owned canonical projection.
export function campaignSource(row:CampaignRow):CampaignRow {
 return rememberCanonicalSource({
  id:row.id,
  policyId:row.policyId,
  eventType:row.eventType,
  scope:row.scope,
  channelId:row.channelId,
  applicability:row.applicability,
  enforcementBehavior:row.enforcementBehavior,
  status:row.status,
  concurrency:row.concurrency,
  rateLimitPerMinute:row.rateLimitPerMinute,
  affectedFileCount:row.affectedFileCount,
  accessibleFileCount:row.accessibleFileCount,
  unavailableFileCount:row.unavailableFileCount,
  estimatedProviderRuns:row.estimatedProviderRuns,
  completedCount:row.completedCount,
  runningCount:row.runningCount,
  failedCount:row.failedCount,
  timedOutCount:row.timedOutCount,
  createdByUsername:row.createdByUsername,
  createdAt:row.createdAt,
  updatedAt:row.updatedAt,
  startedAt:row.startedAt,
  pausedAt:row.pausedAt,
  finishedAt:row.finishedAt,
 });
}
