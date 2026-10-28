import type {Driver} from 'neo4j-driver';
import type {DiscussionWhere,IssueWhere,DiscussionChannelWhere,DiscussionChannelUpdateInput} from '../../src/generated/graphql.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {
  createModerationIssue,
  appendModerationActions,
  type CreateModerationIssueParams,
  type AppendModerationActionsParams,
} from './moderationIssueWrites.js';
export type DiscussionModerationIssue={id:string;issueNumber:number;flaggedServerRuleViolation?:boolean|null};
type Snapshot={id:string;title?:string|null;Author?:{username:string}|null};
export const DISCUSSION_CHANNEL_MODERATION_DEFAULT_SELECTION=`{
  id
  locked
  discussionId
  channelUniqueName
  weightedVotesCount
  botMentions
  archived
  answered
  emoji
  createdAt
}`;
export interface DiscussionModerationRepository{
 findDiscussion(where:DiscussionWhere):Promise<Snapshot[]>;
 findRelatedIssues(where:IssueWhere):Promise<DiscussionModerationIssue[]>;
 // FAMILY-3 / v7 (campaign #284): Issue + ModerationAction + Comment writes are
 // owned Cypher (moderationIssueWrites); setArchived stays on the generated API.
 createArchiveIssue(params:CreateModerationIssueParams[]):Promise<{issues:DiscussionModerationIssue[]}>;
 recordAction(params:AppendModerationActionsParams):Promise<{issues:DiscussionModerationIssue[]}>;
 findDiscussionChannel(where:DiscussionChannelWhere):Promise<Array<{id:string}>>;
 setArchived(where:DiscussionChannelWhere,update:DiscussionChannelUpdateInput):Promise<{discussionChannels:Array<{id:string}>}>;
}
export function createDiscussionModerationRepository(driver:Driver):DiscussionModerationRepository{return{
 async findDiscussion(where){const r=await executeGeneratedOperation<{discussions:Snapshot[]}>(driver,`query DiscussionModerationTarget($where:DiscussionWhere){discussions(where:$where){id title Author{username}}}`,{where});return r.discussions;},
 async findRelatedIssues(where){const r=await executeGeneratedOperation<{issues:DiscussionModerationIssue[]}>(driver,`query DiscussionModerationIssues($where:IssueWhere){issues(where:$where){id issueNumber flaggedServerRuleViolation}}`,{where});return r.issues;},
 async createArchiveIssue(params){const issues=await Promise.all(params.map(p=>createModerationIssue(driver,p)));return{issues:issues as unknown as DiscussionModerationIssue[]};},
 async recordAction(params){const r=await appendModerationActions(driver,params);return{issues:r.issues as unknown as DiscussionModerationIssue[]};},
 async findDiscussionChannel(where){const r=await executeGeneratedOperation<{discussionChannels:Array<{id:string}>}>(driver,`query DiscussionArchiveChannel($where:DiscussionChannelWhere){discussionChannels(where:$where){id}}`,{where});return r.discussionChannels;},
 async setArchived(where,update){const r=await executeGeneratedOperation<{updateDiscussionChannels:{discussionChannels:Array<{id:string}>}}>(driver,`mutation SetDiscussionArchivedState($where:DiscussionChannelWhere,$update:DiscussionChannelUpdateInput){updateDiscussionChannels(where:$where,update:$update){discussionChannels${DISCUSSION_CHANNEL_MODERATION_DEFAULT_SELECTION}}}`,{where,update});return r.updateDiscussionChannels;},
};}
