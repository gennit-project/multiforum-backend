import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { CHANNEL_MEMBERSHIP_SELECTION } from "./forumMembershipSelections.js";

type UpdatedChannels = {channels: unknown[]};
export interface ForumModeratorRepository {
 findModeratorProfile(username: string | null | undefined): Promise<Array<{ModerationProfile?: {displayName: string} | null}>>;
 findPendingInvites(channelUniqueName: string): Promise<Array<{PendingModInvites: Array<{username:string}>}>>;
 connectModerator(channelUniqueName: string, displayName: string): Promise<UpdatedChannels>;
 disconnectModerator(channelUniqueName: string, displayName: string): Promise<UpdatedChannels>;
 disconnectInvite(channelUniqueName: string, username: string): Promise<UpdatedChannels>;
}
const PROFILE = `query ForumModeratorProfile($where: UserWhere) {users(where: $where) {ModerationProfile {displayName}}}`;
const PENDING = `query ForumModeratorPendingInvites($where: ChannelWhere) {channels(where: $where) {PendingModInvites {username}}}`;
const CONNECT = `mutation ConnectForumModerator($where: ChannelWhere, $update: ChannelUpdateInput) {updateChannels(where: $where, update: $update) {channels ${CHANNEL_MEMBERSHIP_SELECTION}}}`;
const DISCONNECT = `mutation DisconnectForumModerator($where: ChannelWhere, $update: ChannelUpdateInput) {updateChannels(where: $where, update: $update) {channels ${CHANNEL_MEMBERSHIP_SELECTION}}}`;
const CANCEL = `mutation DisconnectForumModeratorInvite($where: ChannelWhere, $update: ChannelUpdateInput) {updateChannels(where: $where, update: $update) {channels ${CHANNEL_MEMBERSHIP_SELECTION}}}`;
export function createForumModeratorRepository(driver: Driver): ForumModeratorRepository {
 return {
  async findModeratorProfile(username) {
   return (await executeGeneratedOperation<{users:Array<{ModerationProfile?:{displayName:string}|null}>}>(driver,PROFILE,{where:{username}})).users;
  },
  async findPendingInvites(uniqueName) {
   return (await executeGeneratedOperation<{channels:Array<{PendingModInvites:Array<{username:string}>}>}>(driver,PENDING,{where:{uniqueName}})).channels;
  },
  async connectModerator(uniqueName,displayName) {
   return (await executeGeneratedOperation<{updateChannels:UpdatedChannels}>(driver,CONNECT,{where:{uniqueName},update:{Moderators:[{connect:[{where:{node:{displayName}}}]}]}})).updateChannels;
  },
  async disconnectModerator(uniqueName,displayName) {
   return (await executeGeneratedOperation<{updateChannels:UpdatedChannels}>(driver,DISCONNECT,{where:{uniqueName},update:{Moderators:[{disconnect:[{where:{node:{displayName}}}]}]}})).updateChannels;
  },
  async disconnectInvite(uniqueName,username) {
   return (await executeGeneratedOperation<{updateChannels:UpdatedChannels}>(driver,CANCEL,{where:{uniqueName},update:{PendingModInvites:[{disconnect:[{where:{node:{username}}}]}]}})).updateChannels;
  },
 };
}
export function resolveForumModeratorRepository(context:{driver?:Driver;forumModeratorRepository?:ForumModeratorRepository}):ForumModeratorRepository {
 if(context.forumModeratorRepository)return context.forumModeratorRepository;
 if(!context.driver)throw new Error("Driver is required for forum moderator operations");
 return createForumModeratorRepository(context.driver);
}
