import type { Driver } from "neo4j-driver";
import type { PluginRun, PluginPipelineRun } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { PUBLIC_PIPELINE_ATTEMPT_SELECTION, PUBLIC_PLUGIN_JOB_SELECTION } from "../plugin/publicPipeline.js";

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
  findPipelineHistory(targetId: string, targetType: string): Promise<PluginRun[]>;
  findDownloadHistory(downloadableFileId: string): Promise<PluginRun[]>;
  findSummaryAttempts(targetId: string, targetType: string): Promise<PluginPipelineRun[]>;
  findSummaryJobs(targetId: string, targetType: string): Promise<PluginRun[]>;
}
export function createPipelineHistoryRepository(driver: Driver): PipelineHistoryRepository {
  return {
    async findPipelineHistory(targetId, targetType) {
      const data = await executeGeneratedOperation<{pluginRuns: PluginRun[]}>(driver, PIPELINE_HISTORY, {where: {AND: [{targetId: {eq: targetId}}, {targetType: {eq: targetType}}]}});
      return data.pluginRuns;
    },
    async findDownloadHistory(downloadableFileId) {
      const data = await executeGeneratedOperation<{pluginRuns: PluginRun[]}>(driver, DOWNLOAD_HISTORY, {where: {AND: [{targetId: {eq: downloadableFileId}}, {targetType: {eq: "DownloadableFile"}}]}});
      return data.pluginRuns;
    },
    async findSummaryAttempts(targetId, targetType) {
      const data = await executeGeneratedOperation<{pluginPipelineRuns: PluginPipelineRun[]}>(driver, SUMMARY_ATTEMPTS, {where: {targetId: {eq: targetId}, targetType: {eq: targetType}}});
      return data.pluginPipelineRuns;
    },
    async findSummaryJobs(targetId, targetType) {
      const data = await executeGeneratedOperation<{pluginRuns: PluginRun[]}>(driver, SUMMARY_JOBS, {where: {targetId: {eq: targetId}, targetType: {eq: targetType}}});
      return data.pluginRuns;
    },
  };
}
