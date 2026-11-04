import type { Channel, ChannelRole, ModChannelRole, ServerRole, ModServerRole } from '../../src/generated/graphql.js';
import type { Selection, Projection } from './selection.js';
export const roleChannelAdminsSelection = {Admins:{username:true}} as const satisfies Selection<Channel>;
export const channelRoleOwnerSelection = {Owner:{uniqueName:true}} as const satisfies Selection<ChannelRole> & Selection<ModChannelRole>;
export const serverRoleCapabilitiesSelection = {
  canCreateChannel:true,canCreateDiscussion:true,canCreateEvent:true,canCreateComment:true,
  canUpvoteDiscussion:true,canUpvoteComment:true,canUploadFile:true,canGiveFeedback:true,
  canManageServerSettings:true,canManagePlugins:true,canManageRoles:true,canManageMods:true,
  canManageAdmins:true,canManageSuperAdmins:true,
} as const satisfies Selection<ServerRole>;
export const modServerRoleCapabilitiesSelection = {
  canLockChannel:true,canHideComment:true,canHideEvent:true,canHideDiscussion:true,
  canEditComments:true,canEditDiscussions:true,canEditEvents:true,canGiveFeedback:true,
  canOpenSupportTickets:true,canCloseSupportTickets:true,canReport:true,canSuspendUser:true,
  canArchiveImage:true,canDeleteWiki:true,canPermanentlyRemoveImage:true,
  canRemoveDiscussionChannel:true,canRemoveEventChannel:true,
} as const satisfies Selection<ModServerRole>;
export type RoleChannelAdmins = Projection<Channel, typeof roleChannelAdminsSelection>;
export type RoleOwnerSnapshot = Projection<ChannelRole, typeof channelRoleOwnerSelection>;
export type ServerRoleCapabilities = Projection<ServerRole, typeof serverRoleCapabilitiesSelection>;
export type ModServerRoleCapabilities = Projection<ModServerRole, typeof modServerRoleCapabilitiesSelection>;
