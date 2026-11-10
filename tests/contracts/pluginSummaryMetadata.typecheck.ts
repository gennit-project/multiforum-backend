import type {Driver} from 'neo4j-driver';
import {createPipelineRunPage,createPipelineSummaryPage} from '../../customResolvers/queries/getPluginPipelinePage.js';
import dashboard from '../../customResolvers/queries/getServerHealthDashboard.js';
import type {PluginSummaryMetadataQueryResolvers} from '../../customResolvers/contracts/pluginSummaryMetadata.js';
import type {SummaryFlags} from '../../services/persistence/pipelineSummaryPageRepository.js';
import {pipelineDisplayStatus} from '../../services/plugin/pipelineSummaryPage.js';
declare const driver:Driver;
const actual={getPipelineRunPage:createPipelineRunPage({driver}),getPipelineSummaryPage:createPipelineSummaryPage({driver}),getServerHealthDashboard:dashboard({driver})} satisfies PluginSummaryMetadataQueryResolvers;
// @ts-expect-error EXISTS projection is boolean
const flags:SummaryFlags={hasActiveWork:'true',hasFailedWork:false};
// @ts-expect-error display status remains an exact generated value union
const unknownStatus:ReturnType<typeof pipelineDisplayStatus>='OTHER';
// @ts-expect-error nested cursor metadata must retain boolean hasNextPage
const wrongPage:PluginSummaryMetadataQueryResolvers['getPipelineRunPage']=()=>({displayStatus:'SUCCEEDED',hasActiveWork:false,jobsPageInfo:{hasNextPage:1,endCursor:null}});
const missing=()=>({summary:{discussionCount:0},issueAging:[]});
// @ts-expect-error all selected summary counts are required
const missingCounts:PluginSummaryMetadataQueryResolvers['getServerHealthDashboard']=missing;
void [actual,flags,unknownStatus,wrongPage,missingCounts];

import type {DashboardTimeSeriesRow} from '../../customResolvers/contracts/dashboardTimeSeries.js';
declare const returned: Awaited<ReturnType<ReturnType<typeof dashboard>>>;
// @ts-expect-error selected normalized time-series count cannot be text
const invalidTime: PluginSummaryMetadataQueryResolvers['getServerHealthDashboard'] = () => ({...returned,timeSeries:[{date:'2026-01-01',discussions:'1',comments:0,events:0,downloads:0,issuesOpened:0,moderationActions:0}]});
declare const timeRow: DashboardTimeSeriesRow;
const {comments:omittedComments,...incompleteTime}=timeRow;
// @ts-expect-error query projection must include every COUNT
const missingTime:DashboardTimeSeriesRow=incompleteTime;
void [invalidTime,omittedComments,missingTime];
