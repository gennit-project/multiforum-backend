import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import type {ScratchpadRecipient,ScratchpadCommentSource,ScratchpadDiscussionSource,ScratchpadOwnership,ScratchpadVisibility,ScratchpadEntryProjection} from '../../customResolvers/contracts/scratchpadProjections.js';
export type {ScratchpadCommentSource,ScratchpadDiscussionSource,ScratchpadOwnership,ScratchpadVisibility} from '../../customResolvers/contracts/scratchpadProjections.js';
export interface ScratchpadRepository {
 findRecipient(username:string):Promise<ScratchpadRecipient[]>;
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
  async findRecipient(username){return(await executeGeneratedOperation<{users:ScratchpadRecipient[]}>(driver,RECIPIENT,{where:{username:{eq:username}}})).users;},
  async findCommentSource(id){return(await executeGeneratedOperation<{comments:ScratchpadCommentSource[]}>(driver,COMMENT,{where:{id:{eq:id}}})).comments;},
  async findDiscussionSource(id){return(await executeGeneratedOperation<{discussionChannels:ScratchpadDiscussionSource[]}>(driver,DISCUSSION,{where:{id:{eq:id}}})).discussionChannels;},
  async findOwnership(id){return(await executeGeneratedOperation<{scratchpadEntries:ScratchpadOwnership[]}>(driver,OWNER,{where:{id:{eq:id}}})).scratchpadEntries;},
  async findVisibility(id){return(await executeGeneratedOperation<{scratchpadEntries:ScratchpadVisibility[]}>(driver,VISIBILITY,{where:{id:{eq:id}}})).scratchpadEntries;},
  async deleteEntry(id){await executeGeneratedOperation<{deleteScratchpadEntries:{nodesDeleted:number;relationshipsDeleted:number}}>(driver,DELETE,{where:{id:{eq:id}}});},
  async updateVisibility(id,isPublic){await executeGeneratedOperation<{updateScratchpadEntries:{scratchpadEntries:ScratchpadEntryProjection[]}}>(driver,UPDATE,{where:{id:{eq:id}},update:{isPublic:{set:isPublic}}});},
 };
}
