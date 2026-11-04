import type { MutationResolvers, QueryResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { SelectedResolver } from "./selection.js";

// Explicit schema-executed projections. JSON/DateTime internals remain scalar-owned.
export const pipelineHistorySelection = {
  id:true, pluginId:true, pluginName:true, version:true, scope:true, channelId:true,
  eventType:true, status:true, message:true, durationMs:true, targetId:true,
  targetType:true, payload:true, pipelineId:true, executionOrder:true,
  skippedReason:true, createdAt:true, updatedAt:true,
} as const;
export const downloadHistorySelection = {
  id:true, pluginId:true, version:true, scope:true, channelId:true, eventType:true,
  status:true, message:true, durationMs:true, targetId:true, targetType:true,
  payload:true, createdAt:true, updatedAt:true,
} as const;
export const publicJobSelection = {
  id:true,pluginId:true,pluginName:true,version:true,scope:true,channelId:true,eventType:true,
  durationMs:true,executionOrder:true,skippedReason:true,message:true,
  diagnostics:{code:true,level:true,message:true,details:true,helpUrl:true},
  queuedAt:true,startedAt:true,heartbeatAt:true,timeoutAt:true,finishedAt:true,createdAt:true,updatedAt:true,
} as const;
// Existing normalization passes status/applicability strings through. Their enum
// membership stays a runtime GraphQL concern, not certified by this selection.
export const publicRunSelection = {
  id:true,pipelineId:true,targetId:true,targetType:true,eventType:true,scope:true,
  channelId:true,initiatedByUsername:true,retryOfPipelineRunId:true,attemptNumber:true,
  policyEffectiveAt:true,policyId:true,campaignId:true,queuedAt:true,startedAt:true,
  heartbeatAt:true,timeoutAt:true,finishedAt:true,createdAt:true,updatedAt:true,
  jobs:publicJobSelection,
} as const;
export const publicPageSelection = {
  run:publicRunSelection,hasActiveWork:true,jobsPageInfo:{hasNextPage:true,endCursor:true},
} as const;
export const internalAttemptSelection = {
  id:true,pipelineId:true,targetId:true,targetType:true,eventType:true,scope:true,channelId:true,
  status:true,trigger:true,initiatedByUsername:true,retryOfPipelineRunId:true,attemptNumber:true,
  configurationSnapshot:true,applicability:true,policyEffectiveAt:true,policyId:true,campaignId:true,
  queuedAt:true,startedAt:true,heartbeatAt:true,timeoutAt:true,finishedAt:true,createdAt:true,updatedAt:true,
} as const;
export const internalJobSelection = {
  ...pipelineHistorySelection,publicDiagnostics:true,leaseId:true,queuedAt:true,
  startedAt:true,heartbeatAt:true,timeoutAt:true,finishedAt:true,
} as const;
export const clearedDownloadSelection = {id:true,fileName:true,scanStatus:true,scanReason:true,scanCheckedAt:true} as const;
export const requestedDownloadSelection = {...clearedDownloadSelection,reviewRequestedAt:true,reviewRequestReason:true,reviewRequestedByUsername:true} as const;
export const pluginQueryNames = [
  "getPipelineRuns","getPluginRunsForDownloadableFile","getPipelineSummary","getPublicPipelineRun",
  "getInternalPluginPipelineRun","getServerPluginSecrets",
] as const;
export type PluginQueryResolvers = {
  getPipelineRuns: SelectedResolver<QueryResolvers<GraphQLContext>["getPipelineRuns"], typeof pipelineHistorySelection>;
  getPluginRunsForDownloadableFile: SelectedResolver<QueryResolvers<GraphQLContext>["getPluginRunsForDownloadableFile"], typeof downloadHistorySelection>;
  getPipelineSummary: SelectedResolver<QueryResolvers<GraphQLContext>["getPipelineSummary"], {targetId:true;targetType:true;attempts:typeof publicRunSelection}>;
  getPublicPipelineRun: SelectedResolver<QueryResolvers<GraphQLContext>["getPublicPipelineRun"], typeof publicRunSelection>;
  getInternalPluginPipelineRun: SelectedResolver<QueryResolvers<GraphQLContext>["getInternalPluginPipelineRun"], {attempt:typeof internalAttemptSelection;jobs:typeof internalJobSelection}>;
  getServerPluginSecrets: SelectedResolver<QueryResolvers<GraphQLContext>["getServerPluginSecrets"], {key:true;status:true;lastValidatedAt:true;validationError:true}>;
};
export const pluginMutationNames = ["clearDownloadableFileScan","requestDownloadableFileReview","setServerPluginSecret","trackDownload","updateDownloadableFileSupportSettings"] as const;
export type PluginMutationResolvers = {
  clearDownloadableFileScan: SelectedResolver<MutationResolvers<GraphQLContext>["clearDownloadableFileScan"],typeof clearedDownloadSelection>;
  requestDownloadableFileReview: SelectedResolver<MutationResolvers<GraphQLContext>["requestDownloadableFileReview"],typeof requestedDownloadSelection>;
  setServerPluginSecret: NonNullable<MutationResolvers<GraphQLContext>["setServerPluginSecret"]>;
  trackDownload: NonNullable<MutationResolvers<GraphQLContext>["trackDownload"]>;
  updateDownloadableFileSupportSettings: NonNullable<MutationResolvers<GraphQLContext>["updateDownloadableFileSupportSettings"]>;
};
