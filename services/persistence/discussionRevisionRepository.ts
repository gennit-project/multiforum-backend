import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { createTextVersion } from "./textVersionWrite.js";
export type DiscussionSnapshot = {
  id?: string;
  title?: string | null;
  body?: string | null;
  Author?: { username?: string | null } | null;
  BodyLastEditedBy?: { username?: string | null } | null;
  DiscussionChannels?: Array<{ channelUniqueName?: string | null }> | null;
  PastTitleVersions?: Array<{ id?: string; body?: string | null; createdAt?: string | null }> | null;
  PastBodyVersions?: Array<{ id?: string; body?: string | null; createdAt?: string | null }> | null;
};

export interface DiscussionRevisionRepository {
 findMentionSnapshot(id:string):Promise<DiscussionSnapshot[]>;
 findSnapshot(id:string):Promise<DiscussionSnapshot[]>;
 findAuthor(username:string):Promise<Array<{username:string}>>;
 createRevision(body:string,username:string):Promise<{textVersions:Array<{id:string}>}>;
 findDiscussionId(id:string):Promise<Array<{id:string}>>;
 connectTitleRevision(id:string,revisionId:string):Promise<void>;
 connectBodyRevision(id:string,revisionId:string):Promise<void>;
 setBodyEditor(id:string,username:string):Promise<void>;
}
export const DISCUSSION_REVISION_DEFAULT_SELECTION = `{
  id
  body
  editReason
  title
  deleted
  hasDownload
  hasSensitiveContent
  hasSpoiler
  createdAt
  updatedAt
}`;
export const TEXT_VERSION_DEFAULT_SELECTION = `{
  id
  body
  editReason
  createdAt
  updatedAt
}`;
const SNAPSHOT = `query DiscussionRevisionSnapshot($where: DiscussionWhere) { discussions(where:$where) {
 id title body Author {username} BodyLastEditedBy {username} DiscussionChannels {channelUniqueName}
 PastTitleVersions {id body createdAt} PastBodyVersions {id body createdAt}
} }`;
const MENTION_SNAPSHOT = `query DiscussionRevisionMentionSnapshot($where:DiscussionWhere) {discussions(where:$where) {id title body Author {username displayName} DiscussionChannels {channelUniqueName}}}`;
const AUTHOR = `query DiscussionRevisionAuthor($where:UserWhere) {users(where:$where) {username}}`;
const EXISTS = `query DiscussionRevisionParent($where:DiscussionWhere) {discussions(where:$where) {id}}`;
const CONNECT_TITLE = `mutation ConnectDiscussionTitleRevision($where:DiscussionWhere,$update:DiscussionUpdateInput) {updateDiscussions(where:$where,update:$update) {discussions ${DISCUSSION_REVISION_DEFAULT_SELECTION}}}`;
const CONNECT_BODY = `mutation ConnectDiscussionBodyRevision($where:DiscussionWhere,$update:DiscussionUpdateInput) {updateDiscussions(where:$where,update:$update) {discussions ${DISCUSSION_REVISION_DEFAULT_SELECTION}}}`;
const EDITOR = `mutation SetDiscussionBodyEditor($where:DiscussionWhere,$update:DiscussionUpdateInput) {updateDiscussions(where:$where,update:$update) {discussions ${DISCUSSION_REVISION_DEFAULT_SELECTION}}}`;
export function createDiscussionRevisionRepository(driver:Driver):DiscussionRevisionRepository {
 return {
  async findMentionSnapshot(id){return (await executeGeneratedOperation<{discussions:DiscussionSnapshot[]}>(driver,MENTION_SNAPSHOT,{where:{id:{eq:id}}})).discussions;},
  async findSnapshot(id){return (await executeGeneratedOperation<{discussions:DiscussionSnapshot[]}>(driver,SNAPSHOT,{where:{id:{eq:id}}})).discussions;},
  async findAuthor(username){return (await executeGeneratedOperation<{users:Array<{username:string}>}>(driver,AUTHOR,{where:{username:{eq:username}}})).users;},
  async createRevision(body,username){return createTextVersion(driver,{body},username);},
  async findDiscussionId(id){return (await executeGeneratedOperation<{discussions:Array<{id:string}>}>(driver,EXISTS,{where:{id:{eq:id}}})).discussions;},
  async connectTitleRevision(id,revisionId){await executeGeneratedOperation(driver,CONNECT_TITLE,{where:{id:{eq:id}},update:{PastTitleVersions:[{connect:[{where:{node:{id:{eq:revisionId}}}}]}]}});},
  async connectBodyRevision(id,revisionId){await executeGeneratedOperation(driver,CONNECT_BODY,{where:{id:{eq:id}},update:{PastBodyVersions:[{connect:[{where:{node:{id:{eq:revisionId}}}}]}]}});},
  async setBodyEditor(id,username){await executeGeneratedOperation(driver,EDITOR,{where:{id},update:{BodyLastEditedBy:{disconnect:{},connect:{where:{node:{username}}}}}});},
 };
}
