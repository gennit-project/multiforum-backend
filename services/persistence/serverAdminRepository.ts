import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { SERVER_MEMBERSHIP_SELECTION } from "./serverMembershipSelections.js";

type Users = Array<{username: string}>;
type UpdatedServerConfigs = { serverConfigs: unknown[] };
export interface ServerAdminRepository {
 findPendingInvites(serverName: string): Promise<Array<{PendingAdminInvites: Users}>>;
 connectAdmin(serverName: string, username: string): Promise<UpdatedServerConfigs>;
 disconnectInvite(serverName: string, username: string): Promise<UpdatedServerConfigs>;
}
const PENDING_INVITES = `query ServerAdminPendingInvites($where: ServerConfigWhere) { serverConfigs(where: $where) { PendingAdminInvites {username} } }`;
const CONNECT_ADMIN = `mutation ConnectServerAdmin($where: ServerConfigWhere, $update: ServerConfigUpdateInput) { updateServerConfigs(where: $where, update: $update) {serverConfigs ${SERVER_MEMBERSHIP_SELECTION}} }`;
const DISCONNECT_INVITE = `mutation DisconnectServerAdminInvite($where: ServerConfigWhere, $update: ServerConfigUpdateInput) { updateServerConfigs(where: $where, update: $update) {serverConfigs ${SERVER_MEMBERSHIP_SELECTION}} }`;
export function createServerAdminRepository(driver: Driver): ServerAdminRepository {
 return {
  async findPendingInvites(serverName) {
   return (await executeGeneratedOperation<{serverConfigs:Array<{PendingAdminInvites: Users}>}>(driver,PENDING_INVITES,{where:{serverName:{eq:serverName}}})).serverConfigs;
  },
  async connectAdmin(serverName,username) {
   return (await executeGeneratedOperation<{updateServerConfigs:UpdatedServerConfigs}>(driver,CONNECT_ADMIN,{where:{serverName:{eq:serverName}},update:{Admins:[{connect:[{where:{node:{username:{eq:username}}}}]}]}})).updateServerConfigs;
  },
  async disconnectInvite(serverName,username) {
   return (await executeGeneratedOperation<{updateServerConfigs:UpdatedServerConfigs}>(driver,DISCONNECT_INVITE,{where:{serverName:{eq:serverName}},update:{PendingAdminInvites:[{disconnect:[{where:{node:{username:{eq:username}}}}]}]}})).updateServerConfigs;
  },
 };
}
export function resolveServerAdminRepository(context:{driver?:Driver;serverAdminRepository?:ServerAdminRepository}):ServerAdminRepository {
 if (context.serverAdminRepository) return context.serverAdminRepository;
 if (!context.driver) throw new Error("Driver is required for server administrator operations");
 return createServerAdminRepository(context.driver);
}
