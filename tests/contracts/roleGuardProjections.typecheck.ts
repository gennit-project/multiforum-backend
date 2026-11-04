import type { RoleOwnerSnapshot, ServerRoleCapabilities, ModServerRoleCapabilities } from '../../customResolvers/contracts/roleGuardProjections.js';
// @ts-expect-error selected owner key cannot be omitted
const missingOwner: RoleOwnerSnapshot = {};
// @ts-expect-error a selected owner must include its non-null unique name
const missingName: RoleOwnerSnapshot = {Owner:{}};
// @ts-expect-error capabilities are a fixed completed selection, not sparse flags
const sparse: ServerRoleCapabilities = {canManageRoles:true};
declare const moderator: ModServerRoleCapabilities;
// @ts-expect-error server administration is not selected on moderation roles
void moderator.canManageAdmins;
const orphan: RoleOwnerSnapshot = {Owner:null};
void [missingOwner,missingName,sparse,orphan];
