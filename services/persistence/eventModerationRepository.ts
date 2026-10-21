import type {Driver} from 'neo4j-driver';
import type {EventWhere,IssueWhere,IssueCreateInput,IssueUpdateInput,EventChannelWhere,EventChannelUpdateInput} from '../../src/generated/graphql.js';
import {attachIssueIdentityRelationships,assertIssueIdentityUpdateAllowed} from '../issueTargetIdentity.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
export type EventModerationIssue={id:string;issueNumber:number;flaggedServerRuleViolation?:boolean|null};
type Snapshot={id:string;title?:string|null;Poster?:{username:string}|null};
export const EVENT_CHANNEL_MODERATION_DEFAULT_SELECTION=`{
  id
  locked
  eventId
  channelUniqueName
  archived
  createdAt
}`;
export interface EventModerationRepository{
 findEvent(where:EventWhere):Promise<Snapshot[]>;
 findRelatedIssues(where:IssueWhere):Promise<EventModerationIssue[]>;
 createArchiveIssue(input:IssueCreateInput[]):Promise<{issues:EventModerationIssue[]}>;
 recordAction(where:IssueWhere,update:IssueUpdateInput):Promise<{issues:EventModerationIssue[]}>;
 findEventChannel(where:EventChannelWhere):Promise<Array<{id:string}>>;
 setArchived(where:EventChannelWhere,update:EventChannelUpdateInput):Promise<{eventChannels:Array<{id:string}>}>;
}
const ISSUE_FIELDS='{id issueNumber flaggedServerRuleViolation}';
export function createEventModerationRepository(driver:Driver):EventModerationRepository{return{
 async findEvent(where){const r=await executeGeneratedOperation<{events:Snapshot[]}>(driver,`query EventModerationTarget($where:EventWhere){events(where:$where){id title Poster{username}}}`,{where});return r.events;},
 async findRelatedIssues(where){const r=await executeGeneratedOperation<{issues:EventModerationIssue[]}>(driver,`query EventModerationIssues($where:IssueWhere){issues(where:$where)${ISSUE_FIELDS}}`,{where});return r.issues;},
 async createArchiveIssue(input){const r=await executeGeneratedOperation<{createIssues:{issues:EventModerationIssue[]}}>(driver,`mutation CreateEventArchiveIssue($input:[IssueCreateInput!]!){createIssues(input:$input){issues${ISSUE_FIELDS}}}`,{input:input.map(attachIssueIdentityRelationships)});return r.createIssues;},
 async recordAction(where,update){assertIssueIdentityUpdateAllowed(update);const r=await executeGeneratedOperation<{updateIssues:{issues:EventModerationIssue[]}}>(driver,`mutation RecordEventArchiveAction($where:IssueWhere,$update:IssueUpdateInput){updateIssues(where:$where,update:$update){issues${ISSUE_FIELDS}}}`,{where,update});return r.updateIssues;},
 async findEventChannel(where){const r=await executeGeneratedOperation<{eventChannels:Array<{id:string}>}>(driver,`query EventArchiveChannel($where:EventChannelWhere){eventChannels(where:$where){id}}`,{where});return r.eventChannels;},
 async setArchived(where,update){const r=await executeGeneratedOperation<{updateEventChannels:{eventChannels:Array<{id:string}>}}>(driver,`mutation SetEventArchivedState($where:EventChannelWhere,$update:EventChannelUpdateInput){updateEventChannels(where:$where,update:$update){eventChannels${EVENT_CHANNEL_MODERATION_DEFAULT_SELECTION}}}`,{where,update});return r.updateEventChannels;},
};}
