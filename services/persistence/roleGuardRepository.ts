import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type RoleOwnerSnapshot = { Owner?: { uniqueName?: string | null } | null };
export type RoleCapabilitySnapshot = Record<string, boolean | null>;
export type RoleFilter = Record<string, unknown> | null | undefined;

/** Fixed authorization snapshots; filters retain the generated GraphQL input language. */
export interface RoleGuardRepository {
  findChannelAdmins(uniqueName: string): Promise<Array<{ Admins: Array<{ username: string }> }>>;
  findChannelRoleOwners(where: RoleFilter): Promise<RoleOwnerSnapshot[]>;
  findModChannelRoleOwners(where: RoleFilter): Promise<RoleOwnerSnapshot[]>;
  findServerRoleCapabilities(where: RoleFilter): Promise<RoleCapabilitySnapshot[]>;
  findModServerRoleCapabilities(where: RoleFilter): Promise<RoleCapabilitySnapshot[]>;
}

const CHANNEL_ADMINS = `query RoleAuthoringChannelAdmins($where: ChannelWhere) {
  channels(where: $where) { Admins { username } }
}`;
const CHANNEL_ROLE_OWNERS = `query ChannelRoleTargetOwners($where: ChannelRoleWhere) {
  channelRoles(where: $where) { Owner { uniqueName } }
}`;
const MOD_CHANNEL_ROLE_OWNERS = `query ModChannelRoleTargetOwners($where: ModChannelRoleWhere) {
  modChannelRoles(where: $where) { Owner { uniqueName } }
}`;
const SERVER_ROLE_CAPABILITIES = `query ConnectedServerRoleCapabilities($where: ServerRoleWhere) {
  serverRoles(where: $where) {
    canCreateChannel canCreateDiscussion canCreateEvent canCreateComment
    canUpvoteDiscussion canUpvoteComment canUploadFile canGiveFeedback
    canManageServerSettings canManagePlugins canManageRoles canManageMods
    canManageAdmins canManageSuperAdmins
  }
}`;
const MOD_SERVER_ROLE_CAPABILITIES = `query ConnectedModServerRoleCapabilities($where: ModServerRoleWhere) {
  modServerRoles(where: $where) {
    canLockChannel canHideComment canHideEvent canHideDiscussion
    canEditComments canEditDiscussions canEditEvents canGiveFeedback
    canOpenSupportTickets canCloseSupportTickets canReport canSuspendUser
    canArchiveImage canDeleteWiki canPermanentlyRemoveImage
    canRemoveDiscussionChannel canRemoveEventChannel
  }
}`;

export function createRoleGuardRepository(driver: Driver): RoleGuardRepository {
  return {
    async findChannelAdmins(uniqueName) {
      const data = await executeGeneratedOperation<{ channels: Array<{ Admins: Array<{ username: string }> }> }>(
        driver, CHANNEL_ADMINS, { where: { uniqueName } }
      );
      return data.channels;
    },
    async findChannelRoleOwners(where) {
      const data = await executeGeneratedOperation<{ channelRoles: RoleOwnerSnapshot[] }>(
        driver, CHANNEL_ROLE_OWNERS, { where }
      );
      return data.channelRoles;
    },
    async findModChannelRoleOwners(where) {
      const data = await executeGeneratedOperation<{ modChannelRoles: RoleOwnerSnapshot[] }>(
        driver, MOD_CHANNEL_ROLE_OWNERS, { where }
      );
      return data.modChannelRoles;
    },
    async findServerRoleCapabilities(where) {
      const data = await executeGeneratedOperation<{ serverRoles: RoleCapabilitySnapshot[] }>(
        driver, SERVER_ROLE_CAPABILITIES, { where }
      );
      return data.serverRoles;
    },
    async findModServerRoleCapabilities(where) {
      const data = await executeGeneratedOperation<{ modServerRoles: RoleCapabilitySnapshot[] }>(
        driver, MOD_SERVER_ROLE_CAPABILITIES, { where }
      );
      return data.modServerRoles;
    },
  };
}

export const resolveRoleGuardRepository = (context: {
  driver: Driver;
  roleGuardRepository?: RoleGuardRepository;
}): RoleGuardRepository => context.roleGuardRepository ?? createRoleGuardRepository(context.driver);
