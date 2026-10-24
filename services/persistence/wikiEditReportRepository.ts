import type {Driver} from 'neo4j-driver';
import type {IssueWhere} from '../../ogm_types.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from './moderationIssueWrites.js';
type ReportIssue={id:string;issueNumber:number;flaggedServerRuleViolation?:boolean|null;relatedUsername?:string|null};
export interface WikiEditReportRepository {
 findReportedWiki(id:string):Promise<Array<{id:string;title?:string|null;body?:string|null;Channel?:{uniqueName:string}|null;VersionAuthor?:{username:string}|null}>>;
 findReportedRevision(id:string):Promise<Array<{id:string;body?:string|null;Author?:{username:string}|null}>>;
 findPriorWikiReport(where:IssueWhere):Promise<ReportIssue[]>;
 // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
 // owned Cypher (moderationIssueWrites); reads stay on the generated API.
 createWikiReportIssue(params:CreateModerationIssueParams):Promise<{issues:ReportIssue[]}>;
 appendWikiReport(params:AppendModerationActionsParams):Promise<{issues:ReportIssue[]}>;
}
const PAGE=`query WikiReportTarget($where:WikiPageWhere){wikiPages(where:$where){id title body Channel{uniqueName} VersionAuthor{username}}}`;
const REVISION=`query WikiReportRevision($where:TextVersionWhere){textVersions(where:$where){id body Author{username}}}`;
const PRIOR=`query PriorWikiReport($where:IssueWhere){issues(where:$where){id issueNumber flaggedServerRuleViolation relatedUsername}}`;
export function createWikiEditReportRepository(driver:Driver):WikiEditReportRepository{return{
 async findReportedWiki(id){return(await executeGeneratedOperation<{wikiPages:Awaited<ReturnType<WikiEditReportRepository['findReportedWiki']>>}>(driver,PAGE,{where:{id:{eq:id}}})).wikiPages;},
 async findReportedRevision(id){return(await executeGeneratedOperation<{textVersions:Awaited<ReturnType<WikiEditReportRepository['findReportedRevision']>>}>(driver,REVISION,{where:{id:{eq:id}}})).textVersions;},
 async findPriorWikiReport(where){return(await executeGeneratedOperation<{issues:ReportIssue[]}>(driver,PRIOR,{where})).issues;},
 async createWikiReportIssue(params){const issue=await createModerationIssue(driver,params);return{issues:[issue as ReportIssue]};},
 async appendWikiReport(params){const result=await appendModerationActions(driver,params);return{issues:result.issues as ReportIssue[]};},
};}
