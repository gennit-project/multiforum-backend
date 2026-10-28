import type {Driver} from 'neo4j-driver';
import type {EventWhere,IssueWhere,EventChannelWhere,EventChannelUpdateInput} from '../../src/generated/graphql.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from './moderationIssueWrites.js';
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
 // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
 // owned Cypher (moderationIssueWrites); setArchived stays on the generated API.
 createArchiveIssue(params:CreateModerationIssueParams[]):Promise<{issues:EventModerationIssue[]}>;
 recordAction(params:AppendModerationActionsParams):Promise<{issues:EventModerationIssue[]}>;
 findEventChannel(where:EventChannelWhere):Promise<Array<{id:string}>>;
 setArchived(where:EventChannelWhere,update:EventChannelUpdateInput):Promise<{eventChannels:Array<{id:string}>}>;
}
export function createEventModerationRepository(driver:Driver):EventModerationRepository{return{
 async findEvent(where){const r=await executeGeneratedOperation<{events:Snapshot[]}>(driver,`query EventModerationTarget($where:EventWhere){events(where:$where){id title Poster{username}}}`,{where});return r.events;},
 async findRelatedIssues(where){const r=await executeGeneratedOperation<{issues:EventModerationIssue[]}>(driver,`query EventModerationIssues($where:IssueWhere){issues(where:$where){id issueNumber flaggedServerRuleViolation}}`,{where});return r.issues;},
 async createArchiveIssue(params){const issues=await Promise.all(params.map(p=>createModerationIssue(driver,p)));return{issues:issues as unknown as EventModerationIssue[]};},
 async recordAction(params){const r=await appendModerationActions(driver,params);return{issues:r.issues as unknown as EventModerationIssue[]};},
 async findEventChannel(where){const r=await executeGeneratedOperation<{eventChannels:Array<{id:string}>}>(driver,`query EventArchiveChannel($where:EventChannelWhere){eventChannels(where:$where){id}}`,{where});return r.eventChannels;},
 async setArchived(where,update){const r=await executeGeneratedOperation<{updateEventChannels:{eventChannels:Array<{id:string}>}}>(driver,`mutation SetEventArchivedState($where:EventChannelWhere,$update:EventChannelUpdateInput){updateEventChannels(where:$where,update:$update){eventChannels${EVENT_CHANNEL_MODERATION_DEFAULT_SELECTION}}}`,{where,update});return r.updateEventChannels;},
};}
