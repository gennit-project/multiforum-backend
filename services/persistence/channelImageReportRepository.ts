import type {Driver} from 'neo4j-driver';
import type {IssueCreateInput,IssueUpdateInput,IssueWhere} from '../../ogm_types.js';
import {attachIssueIdentityRelationships,assertIssueIdentityUpdateAllowed} from '../issueTargetIdentity.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
type ReportIssue={id:string;issueNumber:number;flaggedServerRuleViolation?:boolean|null;relatedChannelUniqueName?:string|null;relatedChannelIconName?:string|null;relatedChannelBannerName?:string|null};
export interface ChannelImageReportRepository {
 findReportedChannel(name:string):Promise<Array<{uniqueName:string;displayName?:string|null;channelIconURL?:string|null;channelBannerURL?:string|null}>>;
 findPriorChannelImageReport(where:IssueWhere):Promise<ReportIssue[]>;
 createChannelImageReportIssue(input:IssueCreateInput):Promise<{issues:ReportIssue[]}>;
 appendChannelImageReport(where:IssueWhere,update:IssueUpdateInput):Promise<{issues:ReportIssue[]}>;
}
const CHANNEL=`query ChannelImageReportTarget($where:ChannelWhere){channels(where:$where){uniqueName displayName channelIconURL channelBannerURL}}`;
const PRIOR=`query PriorChannelImageReport($where:IssueWhere){issues(where:$where){id issueNumber flaggedServerRuleViolation}}`;
const CREATE=`mutation CreateChannelImageReportIssue($input:[IssueCreateInput!]!){createIssues(input:$input){issues{id issueNumber flaggedServerRuleViolation}}}`;
const APPEND=`mutation AppendChannelImageReport($where:IssueWhere,$update:IssueUpdateInput){updateIssues(where:$where,update:$update){issues{id issueNumber flaggedServerRuleViolation relatedChannelUniqueName relatedChannelIconName relatedChannelBannerName}}}`;
export function createChannelImageReportRepository(driver:Driver):ChannelImageReportRepository{return{
 async findReportedChannel(name){return(await executeGeneratedOperation<{channels:Awaited<ReturnType<ChannelImageReportRepository['findReportedChannel']>>}>(driver,CHANNEL,{where:{uniqueName:name}})).channels;},
 async findPriorChannelImageReport(where){return(await executeGeneratedOperation<{issues:ReportIssue[]}>(driver,PRIOR,{where})).issues;},
 async createChannelImageReportIssue(input){return(await executeGeneratedOperation<{createIssues:{issues:ReportIssue[]}}>(driver,CREATE,{input:[attachIssueIdentityRelationships(input)]})).createIssues;},
 async appendChannelImageReport(where,update){assertIssueIdentityUpdateAllowed(update);return(await executeGeneratedOperation<{updateIssues:{issues:ReportIssue[]}}>(driver,APPEND,{where,update})).updateIssues;},
};}
