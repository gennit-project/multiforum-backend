import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { CHANNEL_MEMBERSHIP_SELECTION } from "./forumMembershipSelections.js";

type UpdatedChannels={channels:unknown[]};
export interface ForumInvitationRepository {
 connectOwnerInvite(channelUniqueName:string, username:string):Promise<UpdatedChannels>;
 connectModeratorInvite(channelUniqueName:string, username:string):Promise<UpdatedChannels>;
}
const OWNER_INVITE=`mutation InviteForumOwner($where: ChannelWhere, $update: ChannelUpdateInput) {updateChannels(where:$where,update:$update){channels ${CHANNEL_MEMBERSHIP_SELECTION}}}`;
const MODERATOR_INVITE=`mutation InviteForumModerator($where: ChannelWhere, $update: ChannelUpdateInput) {updateChannels(where:$where,update:$update){channels ${CHANNEL_MEMBERSHIP_SELECTION}}}`;
export function createForumInvitationRepository(driver:Driver):ForumInvitationRepository {
 return {
  async connectOwnerInvite(uniqueName,username){
   return (await executeGeneratedOperation<{updateChannels:UpdatedChannels}>(driver,OWNER_INVITE,{where:{uniqueName:{eq:uniqueName}},update:{PendingOwnerInvites:[{connect:[{where:{node:{username:{eq:username}}}}]}]}})).updateChannels;
  },
  async connectModeratorInvite(uniqueName,username){
   return (await executeGeneratedOperation<{updateChannels:UpdatedChannels}>(driver,MODERATOR_INVITE,{where:{uniqueName:{eq:uniqueName}},update:{PendingModInvites:[{connect:[{where:{node:{username:{eq:username}}}}]}]}})).updateChannels;
  },
 };
}
