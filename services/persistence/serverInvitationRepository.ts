import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { SERVER_MEMBERSHIP_SELECTION } from "./serverMembershipSelections.js";

type UpdatedServers={serverConfigs:unknown[]};
export interface ServerInvitationRepository {
 findInvitee(username:string):Promise<Array<{username:string}>>;
 connectAdminInvite(serverName:string,username:string):Promise<UpdatedServers>;
 connectModeratorInvite(serverName:string,username:string):Promise<UpdatedServers>;
}
const INVITEE=`query ServerInvitationRecipient($where: UserWhere) {users(where:$where){username}}`;
const ADMIN_INVITE=`mutation InviteServerAdmin($where: ServerConfigWhere, $update: ServerConfigUpdateInput) {updateServerConfigs(where:$where,update:$update){serverConfigs ${SERVER_MEMBERSHIP_SELECTION}}}`;
const MODERATOR_INVITE=`mutation InviteServerModerator($where: ServerConfigWhere, $update: ServerConfigUpdateInput) {updateServerConfigs(where:$where,update:$update){serverConfigs ${SERVER_MEMBERSHIP_SELECTION}}}`;
export function createServerInvitationRepository(driver:Driver):ServerInvitationRepository {
 return {
  async findInvitee(username){
   return (await executeGeneratedOperation<{users:Array<{username:string}>}>(driver,INVITEE,{where:{username}})).users;
  },
  async connectAdminInvite(serverName,username){
   return (await executeGeneratedOperation<{updateServerConfigs:UpdatedServers}>(driver,ADMIN_INVITE,{where:{serverName},update:{PendingAdminInvites:[{connect:[{where:{node:{username}}}]}]}})).updateServerConfigs;
  },
  async connectModeratorInvite(serverName,username){
   return (await executeGeneratedOperation<{updateServerConfigs:UpdatedServers}>(driver,MODERATOR_INVITE,{where:{serverName},update:{PendingModInvites:[{connect:[{where:{node:{username}}}]}]}})).updateServerConfigs;
  },
 };
}
