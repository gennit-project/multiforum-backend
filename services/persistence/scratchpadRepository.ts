import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
type Username = {username:string};
export type ScratchpadCommentSource = {id:string;UpvotedByUsers?:Username[];SuperUpvotedByUsers?:Username[];DiscussionChannel?:{discussionId?:string;channelUniqueName?:string}|null;CommentAuthor?:Username|Record<string,never>|null};
export type ScratchpadDiscussionSource = {id:string;discussionId?:string;channelUniqueName?:string;UpvotedByUsers?:Username[];SuperUpvotedByUsers?:Username[];Discussion?:{Author?:Username|null}|null};
export type ScratchpadOwnership = {id:string;Recipient?:Username|null};
export type ScratchpadVisibility = ScratchpadOwnership & {isPublic:boolean;text:string;sourceType:string;sourceId:string;sourceChannelUniqueName?:string|null;discussionId?:string|null;createdAt:string;Author?:{username:string;displayName?:string|null;profilePicURL?:string|null}|null};
export interface ScratchpadRepository {
 findRecipient(username:string):Promise<Array<Username & {displayName?:string|null}>>;
 findCommentSource(id:string):Promise<ScratchpadCommentSource[]>;
 findDiscussionSource(id:string):Promise<ScratchpadDiscussionSource[]>;
 findOwnership(id:string):Promise<ScratchpadOwnership[]>;
 findVisibility(id:string):Promise<ScratchpadVisibility[]>;
 deleteEntry(id:string):Promise<void>;
 updateVisibility(id:string,isPublic:boolean):Promise<void>;
}
export const SCRATCHPAD_DEFAULT_SELECTION = `{ id text isPublic sourceType sourceId sourceChannelUniqueName discussionId createdAt }`;
const RECIPIENT=`query ScratchpadRecipient($where:UserWhere){users(where:$where){username displayName}}`;
const COMMENT=`query ScratchpadCommentSource($where:CommentWhere){comments(where:$where){id UpvotedByUsers{username} SuperUpvotedByUsers{username} DiscussionChannel{discussionId channelUniqueName} CommentAuthor{... on User{username}}}}`;
const DISCUSSION=`query ScratchpadDiscussionSource($where:DiscussionChannelWhere){discussionChannels(where:$where){id discussionId channelUniqueName UpvotedByUsers{username} SuperUpvotedByUsers{username} Discussion{Author{username}}}}`;
const OWNER=`query ScratchpadOwnership($where:ScratchpadEntryWhere){scratchpadEntries(where:$where){id Recipient{username}}}`;
const VISIBILITY=`query ScratchpadVisibility($where:ScratchpadEntryWhere){scratchpadEntries(where:$where){id isPublic text sourceType sourceId sourceChannelUniqueName discussionId createdAt Recipient{username} Author{username displayName profilePicURL}}}`;
const DELETE=`mutation DeleteScratchpadEntry($where:ScratchpadEntryWhere){deleteScratchpadEntries(where:$where){nodesDeleted relationshipsDeleted}}`;
const UPDATE=`mutation UpdateScratchpadVisibility($where:ScratchpadEntryWhere,$update:ScratchpadEntryUpdateInput){updateScratchpadEntries(where:$where,update:$update){scratchpadEntries ${SCRATCHPAD_DEFAULT_SELECTION}}}`;
export function createScratchpadRepository(driver:Driver):ScratchpadRepository {
 return {
  async findRecipient(username){return(await executeGeneratedOperation<{users:Array<Username & {displayName?:string|null}>}>(driver,RECIPIENT,{where:{username:{eq:username}}})).users;},
  async findCommentSource(id){return(await executeGeneratedOperation<{comments:ScratchpadCommentSource[]}>(driver,COMMENT,{where:{id:{eq:id}}})).comments;},
  async findDiscussionSource(id){return(await executeGeneratedOperation<{discussionChannels:ScratchpadDiscussionSource[]}>(driver,DISCUSSION,{where:{id:{eq:id}}})).discussionChannels;},
  async findOwnership(id){return(await executeGeneratedOperation<{scratchpadEntries:ScratchpadOwnership[]}>(driver,OWNER,{where:{id:{eq:id}}})).scratchpadEntries;},
  async findVisibility(id){return(await executeGeneratedOperation<{scratchpadEntries:ScratchpadVisibility[]}>(driver,VISIBILITY,{where:{id:{eq:id}}})).scratchpadEntries;},
  async deleteEntry(id){await executeGeneratedOperation(driver,DELETE,{where:{id:{eq:id}}});},
  async updateVisibility(id,isPublic){await executeGeneratedOperation(driver,UPDATE,{where:{id:{eq:id}},update:{isPublic:{set:isPublic}}});},
 };
}
