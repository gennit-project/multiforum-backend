import type { Driver } from "neo4j-driver";
import type { PluginRun, PluginPipelineRun } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { PUBLIC_PIPELINE_ATTEMPT_SELECTION, PUBLIC_PLUGIN_JOB_SELECTION } from "../plugin/publicPipeline.js";

// Exact fields selected by schema-executed operations, never full entities.
import type { PublicAttemptRow, PublicJobRow } from "./pipelineHistoryRepository.js";
export type InternalAttemptRow = PublicAttemptRow & Required<Pick<PluginPipelineRun, "configurationSnapshot">>;
export type InternalJobRow = PublicJobRow & Required<Pick<PluginRun, "message" | "targetId" | "targetType" | "payload" | "leaseId">>;

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
  findPublicAttempt(id: string): Promise<PublicAttemptRow[]>;
  findPublicJobs(pipelineId: string): Promise<PublicJobRow[]>;
  findInternalAttempt(id: string): Promise<InternalAttemptRow[]>;
  findInternalJobs(pipelineId: string): Promise<InternalJobRow[]>;
}
export function createPipelineDetailRepository(driver: Driver): PipelineDetailRepository {
  return {
    async findPublicAttempt(id) {
      const data = await executeGeneratedOperation<{pluginPipelineRuns: PublicAttemptRow[]}>(driver, PUBLIC_ATTEMPT, {where:{id:{eq:id}}});
      return data.pluginPipelineRuns;
    },
    async findPublicJobs(pipelineId) {
      const data = await executeGeneratedOperation<{pluginRuns: PublicJobRow[]}>(driver, PUBLIC_JOBS, {where:{pipelineId:{eq:pipelineId}}});
      return data.pluginRuns;
    },
    async findInternalAttempt(id) {
      const data = await executeGeneratedOperation<{pluginPipelineRuns: InternalAttemptRow[]}>(driver, INTERNAL_ATTEMPT, {where:{id:{eq:id}}});
      return data.pluginPipelineRuns;
    },
    async findInternalJobs(pipelineId) {
      const data = await executeGeneratedOperation<{pluginRuns: InternalJobRow[]}>(driver, INTERNAL_JOBS, {where:{pipelineId:{eq:pipelineId}}});
      return data.pluginRuns;
    },
  };
}
