import type {Driver} from 'neo4j-driver';
import type {IssueCreateInput,IssueUpdateInput,IssueWhere} from '../../ogm_types.js';
import {attachIssueIdentityRelationships,assertIssueIdentityUpdateAllowed} from '../issueTargetIdentity.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
type ReportIssue={id:string;issueNumber:number;flaggedServerRuleViolation?:boolean|null;relatedUsername?:string|null};
export interface WikiEditReportRepository {
 findReportedWiki(id:string):Promise<Array<{id:string;title?:string|null;body?:string|null;Channel?:{uniqueName:string}|null;VersionAuthor?:{username:string}|null}>>;
 findReportedRevision(id:string):Promise<Array<{id:string;body?:string|null;Author?:{username:string}|null}>>;
 findPriorWikiReport(where:IssueWhere):Promise<ReportIssue[]>;
 createWikiReportIssue(input:IssueCreateInput):Promise<{issues:ReportIssue[]}>;
 appendWikiReport(where:IssueWhere,update:IssueUpdateInput):Promise<{issues:ReportIssue[]}>;
}
const PAGE=`query WikiReportTarget($where:WikiPageWhere){wikiPages(where:$where){id title body Channel{uniqueName} VersionAuthor{username}}}`;
const REVISION=`query WikiReportRevision($where:TextVersionWhere){textVersions(where:$where){id body Author{username}}}`;
const PRIOR=`query PriorWikiReport($where:IssueWhere){issues(where:$where){id issueNumber flaggedServerRuleViolation relatedUsername}}`;
const CREATE=`mutation CreateWikiReportIssue($input:[IssueCreateInput!]!){createIssues(input:$input){issues{id issueNumber flaggedServerRuleViolation}}}`;
const APPEND=`mutation AppendWikiReport($where:IssueWhere,$update:IssueUpdateInput){updateIssues(where:$where,update:$update){issues{id issueNumber flaggedServerRuleViolation}}}`;
export function createWikiEditReportRepository(driver:Driver):WikiEditReportRepository{return{
 async findReportedWiki(id){return(await executeGeneratedOperation<{wikiPages:Awaited<ReturnType<WikiEditReportRepository['findReportedWiki']>>}>(driver,PAGE,{where:{id}})).wikiPages;},
 async findReportedRevision(id){return(await executeGeneratedOperation<{textVersions:Awaited<ReturnType<WikiEditReportRepository['findReportedRevision']>>}>(driver,REVISION,{where:{id}})).textVersions;},
 async findPriorWikiReport(where){return(await executeGeneratedOperation<{issues:ReportIssue[]}>(driver,PRIOR,{where})).issues;},
 async createWikiReportIssue(input){return(await executeGeneratedOperation<{createIssues:{issues:ReportIssue[]}}>(driver,CREATE,{input:[attachIssueIdentityRelationships(input)]})).createIssues;},
 async appendWikiReport(where,update){assertIssueIdentityUpdateAllowed(update);return(await executeGeneratedOperation<{updateIssues:{issues:ReportIssue[]}}>(driver,APPEND,{where,update})).updateIssues;},
};}
