import type {StartedAttempt,ReturnedJob} from './pluginExecutionProjections.js';
import {rememberCanonicalSource} from '../../services/canonicalSourceFields.js';

// Fixed completed inner selections; not arbitrary generated response-key maps.
export function startedAttemptSource(row:StartedAttempt):StartedAttempt {
 return rememberCanonicalSource({
  id:row.id,
  pipelineId:row.pipelineId,
  targetId:row.targetId,
  targetType:row.targetType,
  targetVersion:row.targetVersion,
  eventType:row.eventType,
  scope:row.scope,
  channelId:row.channelId,
  status:row.status,
  trigger:row.trigger,
  initiatedByUsername:row.initiatedByUsername,
  retryOfPipelineRunId:row.retryOfPipelineRunId,
  attemptNumber:row.attemptNumber,
  configurationSnapshot:row.configurationSnapshot,
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
 });
}
export function returnedJobSource(row:ReturnedJob):ReturnedJob {
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
