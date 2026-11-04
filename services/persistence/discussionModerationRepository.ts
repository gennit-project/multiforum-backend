import type {ArchiveDiscussionChannelUpdate} from "./archiveProjections.js";
import {archiveIssueAppender, type ArchiveIssueAppender} from "./archiveIssueWrites.js";
import type {ReportModerationIssueRow} from "./moderationIssueWrites.js";
import type {Driver} from 'neo4j-driver';
import type {DiscussionWhere,IssueWhere,DiscussionChannelWhere,DiscussionChannelUpdateInput} from '../../src/generated/graphql.js';
import {executeGeneratedOperation} from './generatedSchemaOperations.js';
import {
  createModerationIssue,
  type CreateModerationIssueParams,
} from './moderationIssueWrites.js';
export type DiscussionModerationIssue={id:string;issueNumber:number;flaggedServerRuleViolation:boolean|null};
type Snapshot={id:string;title:string;Author:{username:string}|null};
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
 createArchiveIssue(params:CreateModerationIssueParams[]):Promise<{issues:ReportModerationIssueRow[]}>;
 recordAction:ArchiveIssueAppender;
 findDiscussionChannel(where:DiscussionChannelWhere):Promise<Array<{id:string}>>;
 setArchived(where:DiscussionChannelWhere,update:DiscussionChannelUpdateInput):Promise<{discussionChannels:ArchiveDiscussionChannelUpdate[]}>;
}
export function createDiscussionModerationRepository(driver:Driver):DiscussionModerationRepository{return{
 async findDiscussion(where){const r=await executeGeneratedOperation<{discussions:Snapshot[]}>(driver,`query DiscussionModerationTarget($where:DiscussionWhere){discussions(where:$where){id title Author{username}}}`,{where});return r.discussions;},
 async findRelatedIssues(where){const r=await executeGeneratedOperation<{issues:DiscussionModerationIssue[]}>(driver,`query DiscussionModerationIssues($where:IssueWhere){issues(where:$where){id issueNumber flaggedServerRuleViolation}}`,{where});return r.issues;},
 async createArchiveIssue(params){const issues=await Promise.all(params.map(p=>createModerationIssue(driver,p)));return{issues:issues};},
 recordAction:archiveIssueAppender(driver),
 async findDiscussionChannel(where){const r=await executeGeneratedOperation<{discussionChannels:Array<{id:string}>}>(driver,`query DiscussionArchiveChannel($where:DiscussionChannelWhere){discussionChannels(where:$where){id}}`,{where});return r.discussionChannels;},
 async setArchived(where,update){const r=await executeGeneratedOperation<{updateDiscussionChannels:{discussionChannels:ArchiveDiscussionChannelUpdate[]}}>(driver,`mutation SetDiscussionArchivedState($where:DiscussionChannelWhere,$update:DiscussionChannelUpdateInput){updateDiscussionChannels(where:$where,update:$update){discussionChannels${DISCUSSION_CHANNEL_MODERATION_DEFAULT_SELECTION}}}`,{where,update});return r.updateDiscussionChannels;},
};}
