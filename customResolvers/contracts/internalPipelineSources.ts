import type {PipelineHistoryRow,DownloadHistoryRow} from '../../services/persistence/pipelineHistoryRepository.js';
import type {InternalAttemptRow,InternalJobRow} from '../../services/persistence/pipelineDetailRepository.js';
import {rememberCanonicalSource} from '../../services/canonicalSourceFields.js';

// These adapters consume fixed alias-free internal documents only, never
// caller-selected generated response-key maps. JSON scalar leaves remain raw.
export function pipelineHistorySource(row:PipelineHistoryRow):PipelineHistoryRow {
 return rememberCanonicalSource({
  id:row.id,
  pluginId:row.pluginId,
  pluginName:row.pluginName,
  version:row.version,
  scope:row.scope,
  channelId:row.channelId,
  eventType:row.eventType,
  status:row.status,
  message:row.message,
  durationMs:row.durationMs,
  targetId:row.targetId,
  targetType:row.targetType,
  payload:row.payload,
  pipelineId:row.pipelineId,
  executionOrder:row.executionOrder,
  skippedReason:row.skippedReason,
  createdAt:row.createdAt,
  updatedAt:row.updatedAt,
 });
}
export function downloadHistorySource(row:DownloadHistoryRow):DownloadHistoryRow {
 return rememberCanonicalSource({
  id:row.id,
  pluginId:row.pluginId,
  version:row.version,
  scope:row.scope,
  channelId:row.channelId,
  eventType:row.eventType,
  status:row.status,
  message:row.message,
  durationMs:row.durationMs,
  targetId:row.targetId,
  targetType:row.targetType,
  payload:row.payload,
  createdAt:row.createdAt,
  updatedAt:row.updatedAt,
 });
}
export function internalAttemptSource(row:InternalAttemptRow):InternalAttemptRow {
 return rememberCanonicalSource({
  id:row.id,
  pipelineId:row.pipelineId,
  targetId:row.targetId,
  targetType:row.targetType,
  eventType:row.eventType,
  scope:row.scope,
  channelId:row.channelId,
  status:row.status,
  trigger:row.trigger,
  initiatedByUsername:row.initiatedByUsername,
  retryOfPipelineRunId:row.retryOfPipelineRunId,
  attemptNumber:row.attemptNumber,
  applicability:row.applicability,
  policyEffectiveAt:row.policyEffectiveAt,
  policyId:row.policyId,
  campaignId:row.campaignId,
  queuedAt:row.queuedAt,
  startedAt:row.startedAt,
  heartbeatAt:row.heartbeatAt,
  timeoutAt:row.timeoutAt,
  finishedAt:row.finishedAt,
  createdAt:row.createdAt,
  updatedAt:row.updatedAt,
  configurationSnapshot:row.configurationSnapshot,
 });
}
export function internalJobSource(row:InternalJobRow):InternalJobRow {
 return rememberCanonicalSource({
  id:row.id,
  pipelineId:row.pipelineId,
  pluginId:row.pluginId,
  pluginName:row.pluginName,
  version:row.version,
  scope:row.scope,
  channelId:row.channelId,
  eventType:row.eventType,
  status:row.status,
  durationMs:row.durationMs,
  executionOrder:row.executionOrder,
  skippedReason:row.skippedReason,
  publicDiagnostics:row.publicDiagnostics,
  queuedAt:row.queuedAt,
  startedAt:row.startedAt,
  heartbeatAt:row.heartbeatAt,
  timeoutAt:row.timeoutAt,
  finishedAt:row.finishedAt,
  createdAt:row.createdAt,
  updatedAt:row.updatedAt,
  message:row.message,
  targetId:row.targetId,
  targetType:row.targetType,
  payload:row.payload,
  leaseId:row.leaseId,
 });
}
