import type {Driver} from 'neo4j-driver';
import type {DiscussionWhere,IssueWhere,IssueCreateInput,IssueUpdateInput,DiscussionChannelWhere,DiscussionChannelUpdateInput} from '../../src/generated/graphql.js';
import {attachIssueIdentityRelationships,assertIssueIdentityUpdateAllowed} from '../issueTargetIdentity.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
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
 createArchiveIssue(input:IssueCreateInput[]):Promise<{issues:DiscussionModerationIssue[]}>;
 recordAction(where:IssueWhere,update:IssueUpdateInput):Promise<{issues:DiscussionModerationIssue[]}>;
 findDiscussionChannel(where:DiscussionChannelWhere):Promise<Array<{id:string}>>;
 setArchived(where:DiscussionChannelWhere,update:DiscussionChannelUpdateInput):Promise<{discussionChannels:Array<{id:string}>}>;
}
const ISSUE_FIELDS='{id issueNumber flaggedServerRuleViolation}';
export function createDiscussionModerationRepository(driver:Driver):DiscussionModerationRepository{return{
 async findDiscussion(where){const r=await executeGeneratedOperation<{discussions:Snapshot[]}>(driver,`query DiscussionModerationTarget($where:DiscussionWhere){discussions(where:$where){id title Author{username}}}`,{where});return r.discussions;},
 async findRelatedIssues(where){const r=await executeGeneratedOperation<{issues:DiscussionModerationIssue[]}>(driver,`query DiscussionModerationIssues($where:IssueWhere){issues(where:$where)${ISSUE_FIELDS}}`,{where});return r.issues;},
 async createArchiveIssue(input){const r=await executeGeneratedOperation<{createIssues:{issues:DiscussionModerationIssue[]}}>(driver,`mutation CreateDiscussionArchiveIssue($input:[IssueCreateInput!]!){createIssues(input:$input){issues${ISSUE_FIELDS}}}`,{input:input.map(attachIssueIdentityRelationships)});return r.createIssues;},
 async recordAction(where,update){assertIssueIdentityUpdateAllowed(update);const r=await executeGeneratedOperation<{updateIssues:{issues:DiscussionModerationIssue[]}}>(driver,`mutation RecordDiscussionArchiveAction($where:IssueWhere,$update:IssueUpdateInput){updateIssues(where:$where,update:$update){issues${ISSUE_FIELDS}}}`,{where,update});return r.updateIssues;},
 async findDiscussionChannel(where){const r=await executeGeneratedOperation<{discussionChannels:Array<{id:string}>}>(driver,`query DiscussionArchiveChannel($where:DiscussionChannelWhere){discussionChannels(where:$where){id}}`,{where});return r.discussionChannels;},
 async setArchived(where,update){const r=await executeGeneratedOperation<{updateDiscussionChannels:{discussionChannels:Array<{id:string}>}}>(driver,`mutation SetDiscussionArchivedState($where:DiscussionChannelWhere,$update:DiscussionChannelUpdateInput){updateDiscussionChannels(where:$where,update:$update){discussionChannels${DISCUSSION_CHANNEL_MODERATION_DEFAULT_SELECTION}}}`,{where,update});return r.updateDiscussionChannels;},
};}
