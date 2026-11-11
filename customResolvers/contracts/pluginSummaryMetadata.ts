import type {RawSelectedResolver} from './rawSelectedSource.js';
import type {QueryResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from './selection.js';
// Computed envelopes only: raw nested run and channel values are
// intentionally outside this boundary and retain selection-time completion.
export const pipelinePageMetadataSelection={displayStatus:true,hasActiveWork:true,jobsPageInfo:{hasNextPage:true,endCursor:true}} as const;
export const pipelineSummaryMetadataSelection={targetId:true,targetType:true,hasActiveWork:true,hasFailedWork:true,pageInfo:{hasNextPage:true,endCursor:true},attempts:pipelinePageMetadataSelection} as const;
export const serverHealthSummarySelection={activeChannelCount:true,discussionCount:true,commentCount:true,eventCount:true,downloadCount:true,voteCount:true,openIssueCount:true,issueOpenedCount:true,issueClosedCount:true,moderationActionCount:true,archivedContentCount:true,lockedContentCount:true,suspensionCount:true,failedDownloadScanCount:true,queuedPluginJobCount:true,runningPluginJobCount:true,pluginTimeoutCount24h:true,pluginTimeoutRate24h:true,repeatedPluginFailureCount24h:true,pluginRetryAttemptCount1h:true,pluginRetryStormCount1h:true,oldestQueuedPluginJobAgeSeconds:true,medianOpenIssueAgeDays:true} as const;
export const dashboardChannelHealthSelection={id:true,channelUniqueName:true,displayName:true,channelIconURL:true,discussionCount:true,commentCount:true,eventCount:true,downloadCount:true,voteCount:true,uniqueContributorCount:true,openIssueCount:true,issueOpenedCount:true,moderationActionCount:true,archivedContentCount:true,lockedContentCount:true,activityScore:true,oldestOpenIssueAgeDays:true,issuesPerHundredContributions:true,healthLabel:true} as const;
export const dashboardTimeSeriesSelection={date:true,discussions:true,comments:true,events:true,downloads:true,issuesOpened:true,moderationActions:true} as const;
export const serverHealthMetadataSelection={summary:serverHealthSummarySelection,timeSeries:dashboardTimeSeriesSelection,issueAging:{label:true,minDays:true,maxDays:true,count:true}} as const;
export const pluginSummaryMetadataQueryNames=['getPipelineRunPage','getPipelineSummaryPage','getServerHealthDashboard'] as const;
export type PluginSummaryMetadataQueryResolvers={
 getPipelineRunPage:SelectedResolver<QueryResolvers<GraphQLContext>['getPipelineRunPage'],typeof pipelinePageMetadataSelection>;
 getPipelineSummaryPage:SelectedResolver<QueryResolvers<GraphQLContext>['getPipelineSummaryPage'],typeof pipelineSummaryMetadataSelection>;
 getServerHealthDashboard:SelectedResolver<QueryResolvers<GraphQLContext>['getServerHealthDashboard'],typeof serverHealthMetadataSelection> & RawSelectedResolver<QueryResolvers<GraphQLContext>['getServerHealthDashboard'],{channelHealth:typeof dashboardChannelHealthSelection}>;
};
