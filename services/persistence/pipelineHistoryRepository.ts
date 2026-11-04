import type { Driver } from "neo4j-driver";
import type { PluginRun, PluginPipelineRun } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { PUBLIC_PIPELINE_ATTEMPT_SELECTION, PUBLIC_PLUGIN_JOB_SELECTION } from "../plugin/publicPipeline.js";

// Exact fields selected by schema-executed operations, never full entities.
export type PipelineHistoryRow = Required<Pick<PluginRun, "id" | "pluginId" | "pluginName" | "version" | "scope" | "channelId" | "eventType" | "status" | "message" | "durationMs" | "targetId" | "targetType" | "payload" | "pipelineId" | "executionOrder" | "skippedReason" | "createdAt" | "updatedAt">>;
export type DownloadHistoryRow = Required<Pick<PluginRun, "id" | "pluginId" | "version" | "scope" | "channelId" | "eventType" | "status" | "message" | "durationMs" | "targetId" | "targetType" | "payload" | "createdAt" | "updatedAt">>;
export type PublicAttemptRow = Required<Pick<PluginPipelineRun, "id" | "pipelineId" | "targetId" | "targetType" | "eventType" | "scope" | "channelId" | "status" | "trigger" | "initiatedByUsername" | "retryOfPipelineRunId" | "attemptNumber" | "applicability" | "policyEffectiveAt" | "policyId" | "campaignId" | "queuedAt" | "startedAt" | "heartbeatAt" | "timeoutAt" | "finishedAt" | "createdAt" | "updatedAt">>;
export type PublicJobRow = Required<Pick<PluginRun, "id" | "pipelineId" | "pluginId" | "pluginName" | "version" | "scope" | "channelId" | "eventType" | "status" | "durationMs" | "executionOrder" | "skippedReason" | "publicDiagnostics" | "queuedAt" | "startedAt" | "heartbeatAt" | "timeoutAt" | "finishedAt" | "createdAt" | "updatedAt">>;

const PIPELINE_HISTORY = `query PIPELINE_HISTORY( $where: PluginRunWhere) { pluginRuns(where: $where, sort: [{ pipelineId: DESC }, { executionOrder: ASC }, { createdAt: DESC }]) {
        id
        pluginId
        pluginName
        version
        scope
        channelId
        eventType
        status
        message
        durationMs
        targetId
        targetType
        payload
        pipelineId
        executionOrder
        skippedReason
        createdAt
        updatedAt
      } }`;
const DOWNLOAD_HISTORY = `query DOWNLOAD_HISTORY( $where: PluginRunWhere) { pluginRuns(where: $where, sort: [{ createdAt: DESC }]) {
        id
        pluginId
        version
        scope
        channelId
        eventType
        status
        message
        durationMs
        targetId
        targetType
        payload
        createdAt
        updatedAt
      } }`;
const SUMMARY_ATTEMPTS = `query PublicPipelineSummaryAttempts($where: PluginPipelineRunWhere) { pluginPipelineRuns(where: $where, sort: [{ createdAt: DESC }]) ${PUBLIC_PIPELINE_ATTEMPT_SELECTION} }`;
const SUMMARY_JOBS = `query PublicPipelineSummaryJobs($where: PluginRunWhere) { pluginRuns(where: $where) ${PUBLIC_PLUGIN_JOB_SELECTION} }`;

export interface PipelineHistoryRepository {
  findPipelineHistory(targetId: string, targetType: string): Promise<PipelineHistoryRow[]>;
  findDownloadHistory(downloadableFileId: string): Promise<DownloadHistoryRow[]>;
  findSummaryAttempts(targetId: string, targetType: string): Promise<PublicAttemptRow[]>;
  findSummaryJobs(targetId: string, targetType: string): Promise<PublicJobRow[]>;
}
export function createPipelineHistoryRepository(driver: Driver): PipelineHistoryRepository {
  return {
    async findPipelineHistory(targetId, targetType) {
      const data = await executeGeneratedOperation<{pluginRuns: PipelineHistoryRow[]}>(driver, PIPELINE_HISTORY, {where: {AND: [{targetId: {eq: targetId}}, {targetType: {eq: targetType}}]}});
      return data.pluginRuns;
    },
    async findDownloadHistory(downloadableFileId) {
      const data = await executeGeneratedOperation<{pluginRuns: DownloadHistoryRow[]}>(driver, DOWNLOAD_HISTORY, {where: {AND: [{targetId: {eq: downloadableFileId}}, {targetType: {eq: "DownloadableFile"}}]}});
      return data.pluginRuns;
    },
    async findSummaryAttempts(targetId, targetType) {
      const data = await executeGeneratedOperation<{pluginPipelineRuns: PublicAttemptRow[]}>(driver, SUMMARY_ATTEMPTS, {where: {targetId: {eq: targetId}, targetType: {eq: targetType}}});
      return data.pluginPipelineRuns;
    },
    async findSummaryJobs(targetId, targetType) {
      const data = await executeGeneratedOperation<{pluginRuns: PublicJobRow[]}>(driver, SUMMARY_JOBS, {where: {targetId: {eq: targetId}, targetType: {eq: targetType}}});
      return data.pluginRuns;
    },
  };
}
