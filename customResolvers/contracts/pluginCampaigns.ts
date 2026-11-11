import type {MutationResolvers,QueryResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from './selection.js';
export const campaignSelection={id:true,policyId:true,eventType:true,scope:true,channelId:true,applicability:true,enforcementBehavior:true,status:true,concurrency:true,rateLimitPerMinute:true,affectedFileCount:true,accessibleFileCount:true,unavailableFileCount:true,estimatedProviderRuns:true,completedCount:true,runningCount:true,failedCount:true,timedOutCount:true,createdByUsername:true,createdAt:true,updatedAt:true,startedAt:true,pausedAt:true,finishedAt:true} as const;
export const campaignPreviewSelection={policyId:true,eventType:true,applicability:true,enforcementBehavior:true,affectedFileCount:true,accessibleFileCount:true,unavailableFileCount:true,estimatedProviderRuns:true} as const;
export const campaignFailureSelection={pipelineId:true,targetId:true,discussionId:true,channelId:true,status:true,attemptNumber:true} as const;
export const pluginCampaignQueryNames=['getPluginPipelineCampaigns','getPluginPipelineCampaignFailures','previewPluginPipelineCampaign'] as const;
export const pluginCampaignMutationNames=['createPluginPipelineCampaign','pausePluginPipelineCampaign','resumePluginPipelineCampaign'] as const;
export type PluginCampaignQueryResolvers={
 getPluginPipelineCampaigns:SelectedResolver<QueryResolvers<GraphQLContext>['getPluginPipelineCampaigns'],typeof campaignSelection>;
 getPluginPipelineCampaignFailures:SelectedResolver<QueryResolvers<GraphQLContext>['getPluginPipelineCampaignFailures'],typeof campaignFailureSelection>;
 previewPluginPipelineCampaign:SelectedResolver<QueryResolvers<GraphQLContext>['previewPluginPipelineCampaign'],typeof campaignPreviewSelection>;
};
export type PluginCampaignMutationResolvers={
 pausePluginPipelineCampaign:SelectedResolver<MutationResolvers<GraphQLContext>['pausePluginPipelineCampaign'],typeof campaignSelection>;
 resumePluginPipelineCampaign:SelectedResolver<MutationResolvers<GraphQLContext>['resumePluginPipelineCampaign'],typeof campaignSelection>;
 createPluginPipelineCampaign:SelectedResolver<MutationResolvers<GraphQLContext>['createPluginPipelineCampaign'],typeof campaignSelection>;
};
