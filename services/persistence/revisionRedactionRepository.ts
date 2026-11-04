import type {Driver} from "neo4j-driver";
import type {RevisionProjection} from "../../customResolvers/contracts/content.js";
import {executeGeneratedOperation} from "./generatedSchemaOperations.js";
export const REDACTED_REVISION_BODY = '[deleted]';
export interface RevisionRedactionRepository {
 findRevision(id:string):Promise<RevisionProjection[]>;
 redactRevision(id:string):Promise<{textVersions:RevisionProjection[]}>;
}
const FIND=`query RedactionRevisionSnapshot($where:TextVersionWhere) {textVersions(where:$where) {id body editReason createdAt updatedAt Author {username}}}`;
const REDACT=`mutation RedactRevisionBody($where:TextVersionWhere,$update:TextVersionUpdateInput) {updateTextVersions(where:$where,update:$update) {textVersions {id body editReason createdAt updatedAt Author {username}}}}`;
export function createRevisionRedactionRepository(driver:Driver):RevisionRedactionRepository {
 return {
  async findRevision(id){return (await executeGeneratedOperation<{textVersions:RevisionProjection[]}>(driver,FIND,{where:{id:{eq:id}}})).textVersions;},
  async redactRevision(id){return (await executeGeneratedOperation<{updateTextVersions:{textVersions:RevisionProjection[]}}>(driver,REDACT,{where:{id:{eq:id}},update:{body:{set:REDACTED_REVISION_BODY}}})).updateTextVersions;},
 };
}
