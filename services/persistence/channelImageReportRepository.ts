import type {Driver} from 'neo4j-driver';
import type {IssueWhere} from '../../ogm_types.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from './moderationIssueWrites.js';
type ReportIssue={id:string;issueNumber:number;flaggedServerRuleViolation?:boolean|null;relatedChannelUniqueName?:string|null;relatedChannelIconName?:string|null;relatedChannelBannerName?:string|null};
export interface ChannelImageReportRepository {
 findReportedChannel(name:string):Promise<Array<{uniqueName:string;displayName?:string|null;channelIconURL?:string|null;channelBannerURL?:string|null}>>;
 findPriorChannelImageReport(where:IssueWhere):Promise<ReportIssue[]>;
 // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
 // owned Cypher (moderationIssueWrites); reads stay on the generated API.
 createChannelImageReportIssue(params:CreateModerationIssueParams):Promise<{issues:ReportIssue[]}>;
 appendChannelImageReport(params:AppendModerationActionsParams):Promise<{issues:ReportIssue[]}>;
}
const CHANNEL=`query ChannelImageReportTarget($where:ChannelWhere){channels(where:$where){uniqueName displayName channelIconURL channelBannerURL}}`;
const PRIOR=`query PriorChannelImageReport($where:IssueWhere){issues(where:$where){id issueNumber flaggedServerRuleViolation}}`;
export function createChannelImageReportRepository(driver:Driver):ChannelImageReportRepository{return{
 async findReportedChannel(name){return(await executeGeneratedOperation<{channels:Awaited<ReturnType<ChannelImageReportRepository['findReportedChannel']>>}>(driver,CHANNEL,{where:{uniqueName:{eq:name}}})).channels;},
 async findPriorChannelImageReport(where){return(await executeGeneratedOperation<{issues:ReportIssue[]}>(driver,PRIOR,{where})).issues;},
 async createChannelImageReportIssue(params){const issue=await createModerationIssue(driver,params);return{issues:[issue as ReportIssue]};},
 async appendChannelImageReport(params){const result=await appendModerationActions(driver,params);return{issues:result.issues as ReportIssue[]};},
};}
