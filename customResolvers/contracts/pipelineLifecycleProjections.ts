import type {PluginPipelineRun} from '../../src/generated/graphql.js';
import type {Selection,Projection} from './selection.js';
import type {ExecutionPendingRun} from './pipelineExecutorProjections.js';
export const pipelineLifecycleAttemptSelection={
 id:true,pipelineId:true,targetId:true,targetType:true,targetVersion:true,eventType:true,
 scope:true,channelId:true,initiatedByUsername:true,retryOfPipelineRunId:true,
 attemptNumber:true,applicability:true,policyId:true,campaignId:true,
 configurationSnapshot:true,status:true,trigger:true,policyEffectiveAt:true,
 notifiedAt:true,queuedAt:true,startedAt:true,heartbeatAt:true,timeoutAt:true,
 finishedAt:true,createdAt:true,updatedAt:true,
} as const satisfies Selection<PluginPipelineRun>;
export const pipelineAttemptNumberSelection={attemptNumber:true} as const satisfies Selection<PluginPipelineRun>;
export type PipelineLifecycleAttempt=Projection<PluginPipelineRun,typeof pipelineLifecycleAttemptSelection>;
export type PipelineAttemptNumber=Projection<PluginPipelineRun,typeof pipelineAttemptNumberSelection>;
export type PipelineAttemptPayload={pluginPipelineRuns:PipelineLifecycleAttempt[]};
export type PipelineJobPayload={pluginRuns:ExecutionPendingRun[]};
