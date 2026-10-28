import type { Driver } from "neo4j-driver";
import type { PluginRun, PluginPipelineRun } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { PUBLIC_PIPELINE_ATTEMPT_SELECTION, PUBLIC_PLUGIN_JOB_SELECTION } from "../plugin/publicPipeline.js";

const PUBLIC_ATTEMPT = `query PublicPipelineDetailAttempt($where: PluginPipelineRunWhere) { pluginPipelineRuns(where: $where) ${PUBLIC_PIPELINE_ATTEMPT_SELECTION} }`;
const PUBLIC_JOBS = `query PublicPipelineDetailJobs($where: PluginRunWhere) { pluginRuns(where: $where, sort: [{executionOrder: ASC}]) ${PUBLIC_PLUGIN_JOB_SELECTION} }`;
const INTERNAL_ATTEMPT = `query InternalPipelineDetailAttempt($where: PluginPipelineRunWhere) { pluginPipelineRuns(where: $where) {
      id pipelineId targetId targetType eventType scope channelId status trigger
      initiatedByUsername retryOfPipelineRunId attemptNumber
      configurationSnapshot applicability policyEffectiveAt policyId campaignId queuedAt startedAt
      heartbeatAt timeoutAt finishedAt createdAt updatedAt
    } }`;
const INTERNAL_JOBS = `query InternalPipelineDetailJobs($where: PluginRunWhere) { pluginRuns(where: $where, sort: [{executionOrder: ASC}]) {
      id pluginId pluginName version scope channelId eventType status message
      durationMs targetId targetType payload publicDiagnostics pipelineId
      executionOrder skippedReason leaseId queuedAt startedAt heartbeatAt
      timeoutAt finishedAt createdAt updatedAt
    } }`;

export interface PipelineDetailRepository {
  findPublicAttempt(id: string): Promise<PluginPipelineRun[]>;
  findPublicJobs(pipelineId: string): Promise<PluginRun[]>;
  findInternalAttempt(id: string): Promise<PluginPipelineRun[]>;
  findInternalJobs(pipelineId: string): Promise<PluginRun[]>;
}
export function createPipelineDetailRepository(driver: Driver): PipelineDetailRepository {
  return {
    async findPublicAttempt(id) {
      const data = await executeGeneratedOperation<{pluginPipelineRuns: PluginPipelineRun[]}>(driver, PUBLIC_ATTEMPT, {where:{id:{eq:id}}});
      return data.pluginPipelineRuns;
    },
    async findPublicJobs(pipelineId) {
      const data = await executeGeneratedOperation<{pluginRuns: PluginRun[]}>(driver, PUBLIC_JOBS, {where:{pipelineId:{eq:pipelineId}}});
      return data.pluginRuns;
    },
    async findInternalAttempt(id) {
      const data = await executeGeneratedOperation<{pluginPipelineRuns: PluginPipelineRun[]}>(driver, INTERNAL_ATTEMPT, {where:{id:{eq:id}}});
      return data.pluginPipelineRuns;
    },
    async findInternalJobs(pipelineId) {
      const data = await executeGeneratedOperation<{pluginRuns: PluginRun[]}>(driver, INTERNAL_JOBS, {where:{pipelineId:{eq:pipelineId}}});
      return data.pluginRuns;
    },
  };
}
