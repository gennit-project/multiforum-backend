import type {Driver} from "neo4j-driver";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
import {createTextVersion, splitTextVersionInput} from "./textVersionWrite.js";
export type WikiRevisionSnapshot={id:string;title:string;body?:string|null;editReason?:string|null;VersionAuthor?:{username?:string|null}|null;PastVersions?:Array<{id:string;body?:string|null;createdAt?:string|null}>};
export interface WikiRevisionRepository {
 findSnapshot(id:string):Promise<WikiRevisionSnapshot[]>;
 findAuthor(username:string):Promise<Array<{username:string}>>;
 createRevision(input:Record<string,unknown>):Promise<{textVersions:Array<{id:string}>}>;
 findPageId(id:string):Promise<Array<{id:string}>>;
 connectRevision(id:string,revisionId:string):Promise<void>;
}
export const WIKI_REVISION_DEFAULT_SELECTION=`{
  id
  title
  body
  editReason
  slug
  channelUniqueName
  locked
  lockReason
  lockedByUsername
  lockedAt
  createdAt
  updatedAt
}`;
export const WIKI_TEXT_VERSION_DEFAULT_SELECTION=`{
  id
  body
  editReason
  createdAt
  updatedAt
}`;
const SNAPSHOT=`query WikiRevisionSnapshot($where:WikiPageWhere) {wikiPages(where:$where) {id title body editReason VersionAuthor {username} PastVersions {id body createdAt}}}`;
const AUTHOR=`query WikiRevisionAuthor($where:UserWhere) {users(where:$where) {username}}`;
const EXISTS=`query WikiRevisionParent($where:WikiPageWhere) {wikiPages(where:$where) {id}}`;
const CONNECT=`mutation ConnectWikiRevision($where:WikiPageWhere,$update:WikiPageUpdateInput) {updateWikiPages(where:$where,update:$update) {wikiPages ${WIKI_REVISION_DEFAULT_SELECTION}}}`;
export function createWikiRevisionRepository(driver:Driver):WikiRevisionRepository {
 return {
  async findSnapshot(id){return (await executeGeneratedOperation<{wikiPages:WikiRevisionSnapshot[]}>(driver,SNAPSHOT,{where:{id}})).wikiPages;},
  async findAuthor(username){return (await executeGeneratedOperation<{users:Array<{username:string}>}>(driver,AUTHOR,{where:{username}})).users;},
  async createRevision(input){const {scalars,authorUsername}=splitTextVersionInput(input);return createTextVersion(driver,scalars,authorUsername);},
  async findPageId(id){return (await executeGeneratedOperation<{wikiPages:Array<{id:string}>}>(driver,EXISTS,{where:{id}})).wikiPages;},
  async connectRevision(id,revisionId){await executeGeneratedOperation(driver,CONNECT,{where:{id},update:{PastVersions:{connect:[{where:{node:{id:revisionId}}}]}}});},
 };
}
