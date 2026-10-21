import type {Driver} from "neo4j-driver";
import type {TextVersion} from "../../ogm_types.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export const REDACTED_REVISION_BODY = '[deleted]';
export interface RevisionRedactionRepository {
 findRevision(id:string):Promise<TextVersion[]>;
 redactRevision(id:string):Promise<{textVersions:TextVersion[]}>;
}
const FIND=`query RedactionRevisionSnapshot($where:TextVersionWhere) {textVersions(where:$where) {id body editReason createdAt updatedAt Author {username}}}`;
const REDACT=`mutation RedactRevisionBody($where:TextVersionWhere,$update:TextVersionUpdateInput) {updateTextVersions(where:$where,update:$update) {textVersions {id body editReason createdAt updatedAt Author {username}}}}`;
export function createRevisionRedactionRepository(driver:Driver):RevisionRedactionRepository {
 return {
  async findRevision(id){return (await executeGeneratedOperation<{textVersions:TextVersion[]}>(driver,FIND,{where:{id}})).textVersions;},
  async redactRevision(id){return (await executeGeneratedOperation<{updateTextVersions:{textVersions:TextVersion[]}}>(driver,REDACT,{where:{id},update:{body:REDACTED_REVISION_BODY}})).updateTextVersions;},
 };
}
