import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { CHANNEL_MEMBERSHIP_SELECTION } from "./forumMembershipSelections.js";

type Users = Array<{username: string}>;
type UpdatedChannels = { channels: unknown[] };
export interface ForumOwnerRepository {
 findPendingInvites(channelUniqueName: string): Promise<Array<{PendingOwnerInvites: Users}>>;
 findAdmins(channelUniqueName: string): Promise<Array<{Admins: Users}>>;
 connectOwner(channelUniqueName: string, username: string): Promise<UpdatedChannels>;
 disconnectOwner(channelUniqueName: string, username: string): Promise<UpdatedChannels>;
 disconnectInvite(channelUniqueName: string, username: string): Promise<UpdatedChannels>;
}
const PENDING_INVITES = `query ForumOwnerPendingInvites($where: ChannelWhere) { channels(where: $where) { PendingOwnerInvites {username} } }`;
const ADMINS = `query ForumOwnerAdmins($where: ChannelWhere) { channels(where: $where) { Admins {username} } }`;
const CONNECT_OWNER = `mutation ConnectForumOwner($where: ChannelWhere, $update: ChannelUpdateInput) { updateChannels(where: $where, update: $update) {channels ${CHANNEL_MEMBERSHIP_SELECTION}} }`;
const DISCONNECT_OWNER = `mutation DisconnectForumOwner($where: ChannelWhere, $update: ChannelUpdateInput) { updateChannels(where: $where, update: $update) {channels ${CHANNEL_MEMBERSHIP_SELECTION}} }`;
const DISCONNECT_INVITE = `mutation DisconnectForumOwnerInvite($where: ChannelWhere, $update: ChannelUpdateInput) { updateChannels(where: $where, update: $update) {channels ${CHANNEL_MEMBERSHIP_SELECTION}} }`;
export function createForumOwnerRepository(driver: Driver): ForumOwnerRepository {
 return {
  async findPendingInvites(uniqueName) {
   return (await executeGeneratedOperation<{channels:Array<{PendingOwnerInvites: Users}>}>(driver,PENDING_INVITES,{where:{uniqueName:{eq:uniqueName}}})).channels;
  },
  async findAdmins(uniqueName) {
   return (await executeGeneratedOperation<{channels:Array<{Admins: Users}>}>(driver,ADMINS,{where:{uniqueName:{eq:uniqueName}}})).channels;
  },
  async connectOwner(uniqueName,username) {
   return (await executeGeneratedOperation<{updateChannels:UpdatedChannels}>(driver,CONNECT_OWNER,{where:{uniqueName:{eq:uniqueName}},update:{Admins:[{connect:[{where:{node:{username:{eq:username}}}}]}]}})).updateChannels;
  },
  async disconnectOwner(uniqueName,username) {
   return (await executeGeneratedOperation<{updateChannels:UpdatedChannels}>(driver,DISCONNECT_OWNER,{where:{uniqueName:{eq:uniqueName}},update:{Admins:[{disconnect:[{where:{node:{username:{eq:username}}}}]}]}})).updateChannels;
  },
  async disconnectInvite(uniqueName,username) {
   return (await executeGeneratedOperation<{updateChannels:UpdatedChannels}>(driver,DISCONNECT_INVITE,{where:{uniqueName:{eq:uniqueName}},update:{PendingOwnerInvites:[{disconnect:[{where:{node:{username:{eq:username}}}}]}]}})).updateChannels;
  },
 };
}
export function resolveForumOwnerRepository(context:{driver?:Driver;forumOwnerRepository?:ForumOwnerRepository}):ForumOwnerRepository {
 if (context.forumOwnerRepository) return context.forumOwnerRepository;
 if (!context.driver) throw new Error("Driver is required for forum owner operations");
 return createForumOwnerRepository(context.driver);
}
