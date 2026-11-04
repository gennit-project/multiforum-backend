import type { NativeServerAuthorizationSnapshot } from "../../customResolvers/contracts/serverAuthorizationSource.js";
import type { PermissionServerConfig } from "../../services/persistence/permissionServerConfigRepository.js";
import type { EffectiveRole } from "../../rules/permission/actorCapabilities.js";

declare const source: NativeServerAuthorizationSnapshot;
// @ts-expect-error native properties have not passed Boolean completion
const capability: boolean = source.DefaultServerRole!.canManageRoles;
// @ts-expect-error native identities have not passed String completion
const identity: string = source.Admins[0].username;
// @ts-expect-error every native container is required, even if its value is null
const missing: NativeServerAuthorizationSnapshot = { Admins: [], SuperAdmins: [], Moderators: [] };
declare const cached: PermissionServerConfig;
// @ts-expect-error the request cache must not turn raw properties into Booleans
const cachedCapability: boolean = cached.DefaultAdminRole!.canManageRoles;
// @ts-expect-error download feature flags also need an explicit comparison
const downloads: boolean = cached.enableDownloads;
declare const effective: Exclude<EffectiveRole, "all" | null | undefined>;
// @ts-expect-error selecting a role does not validate its capability values
const effectiveCapability: boolean = effective.canManageRoles;
void [capability, identity, missing, cachedCapability, downloads, effectiveCapability];

// @ts-expect-error native suspension IDs are not completed GraphQL IDs
const suspensionId: string = source.SuspendedUsers[0].id;
// @ts-expect-error cached suspension flags are not completed Booleans
const indefinite: boolean = cached.SuspendedUsers[0].suspendedIndefinitely;
void [suspensionId, indefinite];
