import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { SERVER_MEMBERSHIP_SELECTION } from "./serverMembershipSelections.js";

type UpdatedServers = {serverConfigs: unknown[]};
export interface ServerModeratorRepository {
 findModeratorProfile(username: string | null | undefined): Promise<Array<{ModerationProfile?: {displayName: string} | null}>>;
 findPendingInvites(serverName: string): Promise<Array<{PendingModInvites: Array<{username:string}>}>>;
 connectModerator(serverName: string, displayName: string): Promise<UpdatedServers>;
 disconnectInvite(serverName: string, username: string): Promise<UpdatedServers>;
}
const PROFILE = `query ServerModeratorProfile($where: UserWhere) {users(where: $where) {ModerationProfile {displayName}}}`;
const PENDING = `query ServerModeratorPendingInvites($where: ServerConfigWhere) {serverConfigs(where: $where) {PendingModInvites {username}}}`;
const CONNECT = `mutation ConnectServerModerator($where: ServerConfigWhere, $update: ServerConfigUpdateInput) {updateServerConfigs(where: $where, update: $update) {serverConfigs ${SERVER_MEMBERSHIP_SELECTION}}}`;
const CANCEL = `mutation DisconnectServerModeratorInvite($where: ServerConfigWhere, $update: ServerConfigUpdateInput) {updateServerConfigs(where: $where, update: $update) {serverConfigs ${SERVER_MEMBERSHIP_SELECTION}}}`;
export function createServerModeratorRepository(driver: Driver): ServerModeratorRepository {
 return {
  async findModeratorProfile(username) {
   return (await executeGeneratedOperation<{users:Array<{ModerationProfile?:{displayName:string}|null}>}>(driver,PROFILE,{where:{username:{eq:username}}})).users;
  },
  async findPendingInvites(serverName) {
   return (await executeGeneratedOperation<{serverConfigs:Array<{PendingModInvites:Array<{username:string}>}>}>(driver,PENDING,{where:{serverName:{eq:serverName}}})).serverConfigs;
  },
  async connectModerator(serverName,displayName) {
   return (await executeGeneratedOperation<{updateServerConfigs:UpdatedServers}>(driver,CONNECT,{where:{serverName:{eq:serverName}},update:{Moderators:[{connect:[{where:{node:{displayName:{eq:displayName}}}}]}]}})).updateServerConfigs;
  },
  async disconnectInvite(serverName,username) {
   return (await executeGeneratedOperation<{updateServerConfigs:UpdatedServers}>(driver,CANCEL,{where:{serverName:{eq:serverName}},update:{PendingModInvites:[{disconnect:[{where:{node:{username:{eq:username}}}}]}]}})).updateServerConfigs;
  },
 };
}
export function resolveServerModeratorRepository(context:{driver?:Driver;serverModeratorRepository?:ServerModeratorRepository}):ServerModeratorRepository {
 if(context.serverModeratorRepository)return context.serverModeratorRepository;
 if(!context.driver)throw new Error("Driver is required for server moderator operations");
 return createServerModeratorRepository(context.driver);
}
