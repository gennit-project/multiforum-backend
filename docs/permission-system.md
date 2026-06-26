# Permission System Architecture

Multiforum uses a comprehensive role-based permission system that governs what actions users can perform across the platform. The system operates at both server-wide and channel-specific levels.

## Permission Model Overview

The permission system uses the following components:

### Types of Roles

1. **Server Roles** - Server-wide role definitions for regular users
   - Define baseline permissions for all users across the platform
   - Examples: `canCreateChannel`, `canCreateDiscussion`, `canUpvoteComment`

2. **Channel Roles** - Channel-specific role definitions for regular users
   - Define permissions for actions within specific channels
   - Examples: `canCreateDiscussion`, `canCreateComment`, `canUpvoteDiscussion`

3. **Mod Server Roles** - Server-wide role definitions for moderators
   - Define baseline moderation capabilities across all channels
   - Examples: `canHideComment`, `canGiveFeedback`, `canSuspendUser`

4. **Mod Channel Roles** - Channel-specific role definitions for moderators
   - Define moderation capabilities within specific channels
   - Examples: `canHideDiscussion`, `canGiveFeedback`, `canReport`

5. **Suspended Roles** - Define restricted permissions for suspended users/moderators
   - Different variants for regular users and moderators
   - Typically limit user capabilities while suspended

### User Classifications

- **Regular Users** - Standard platform users
- **Channel Owners** - Have administrative control over specific channels
- **Moderators** - Users with moderation capabilities
- **Suspended Users** - Users with temporarily restricted permissions
- **Server Admins** (`ServerConfig.Admins`) - Permissive server-wide tier; **restricted by default** (the seeded admin role omits `canManageAdmins`)
- **Super Admins** (`ServerConfig.SuperAdmins`) - The operational apex; their role holds `canManageAdmins`/`canManageSuperAdmins`, so they can mint other admins. Self-managing.
- **Root** - The env break-glass super-user (`SUPERADMIN_EMAIL`); holds every capability unconditionally. See [Server administration](#server-administration-capabilities-tiers-and-root).

> **Historical note:** the backend previously had a single `isAdmin` check
> ("you're in `Admins` ⇒ you can do anything"). It has been **removed**. Admin
> power now flows through the capability/tier model below; the only unconditional
> override is the env root.

## How Permissions Are Applied

The permission system follows a hierarchical flow:

1. **Authentication Check**
   - Verifies that the user is logged in and their JWT is valid

2. **Role Determination**
   - For each action, the system determines which role applies to the user
   - **First**, a server admin (incl. SuperAdmins) or root short-circuits channel
     and ownership checks via `passesAsServerAdminOrRoot` (unless the admin is
     server-suspended; root is never restricted). Otherwise:
   - The system follows this priority order when determining permissions:
     - For regular user actions (e.g., creating posts):
       1. Channel Owner status (automatic permission for all channel actions)
       2. Suspension status (uses SuspendedRole if suspended)
       3. Channel-specific roles
       4. Channel default role
       5. Server default role
     - For moderation actions:
       1. Channel Owner status (automatic permission for all moderation actions)
       2. Suspension status (uses SuspendedModRole if suspended)
       3. Elevated moderator status and role
       4. Default moderator role
       5. Server default moderator role

3. **Permission Verification**
   - Once the appropriate role is determined, the system checks if that role grants the specific permission required for the action
   - If the permission is granted, the action proceeds
   - If the permission is denied, an error is returned

## Special Cases

- **Server admins and root** pass any channel permission, channel-mod, or
  ownership check across the whole server, via `passesAsServerAdminOrRoot`
  (`rules/permission/serverAdminOverride.ts`). This is the override that replaced
  the per-call-site `isAdmin`. It is **suspension-aware**: a server-*suspended*
  admin loses the override and falls back to the normal (restricted) role checks;
  **root** is the only actor a suspension cannot stop. It is deliberately **not**
  applied to account ownership (`isAccountOwner`) — editing/deleting another
  user's account is self-only by design.
- **Channel Owners** resolve the channel's configurable `ElevatedChannelRole`;
  until one is configured they retain every permission (current default). So
  "owners have full permissions" is the default, not a hardcoded bypass.
- **Feedback Comments** require moderator permissions (`canGiveFeedback`) rather than standard comment permissions
- **Suspended Users** have limited permissions based on the Suspended roles

## Server administration (capabilities, tiers, and root)

Server-administration actions are gated by **fine-grained capabilities on
`ServerRole`/`ModServerRole`**, not a blanket admin flag. The server scope is
symmetric with the channel scope: a membership connection on `ServerConfig`
selects a configurable governing role.

| Capability (`ServerRole`) | Gates |
| --- | --- |
| `canManageServerSettings` | `create/update/deleteServerConfigs`, `deleteFilterGroups`/`Options` |
| `canManagePlugins` | plugin install/enable/refresh/secret/delete |
| `canManageRoles` | `create/deleteServerRoles`, `create/updateModServerRoles`, `create*ChannelRoles`, `deleteChannelRoles` |
| `canManageMods` | `invite/cancelInviteServerMod` |
| `canManageAdmins` (**apex**) | `invite/cancelInviteServerAdmin` |
| `canManageSuperAdmins` (**apex**) | add/remove `ServerConfig.SuperAdmins` |

Plus destructive structural caps on `ModServerRole`: `canRemoveDiscussionChannel`,
`canRemoveEventChannel`.

**Tier resolution** (`hasServerPermission.ts`, `hasServerModPermission.ts`):
root → super-admin role → admin role → moderator role → default role, with
**suspension taking precedence over tier**. The seeded **admin** role is
permissive but omits `canManageAdmins` (every regular admin is "restricted" by
default); the ability to mint admins lives in the **SuperAdmins** tier and root.

**Root** (`SUPERADMIN_EMAIL`, plus `CYPRESS_ADMIN_TEST_EMAIL` in tests) is the env
break-glass super-user: it holds every capability unconditionally, is immutable
from the database, and is the only override a suspension cannot restrict. Its job
is to bootstrap the first SuperAdmin and to recover if `SuperAdmins` is emptied.

The seeded default roles are the single source of truth for what each tier
grants and are installed/repaired idempotently by `provisionServerDefaults`
(`npm run provision`).

### No-privilege-escalation invariant

Because role authoring and assignment are themselves capabilities, an actor must
never grant, assign, or edit a role to exceed their **own** resolved
capabilities — otherwise a restricted admin with `canManageRoles` could mint
`canManageAdmins`. This is enforced at every grant path:

- **Direct role authoring** — `createServerRoles`/`createModServerRoles`/
  `updateModServerRoles` reject any capability the actor doesn't hold
  (`rules/validation/roleEscalation.ts`, comparing against the actor's effective
  role from `rules/permission/actorCapabilities.ts`).
- **Nested role writes via `ServerConfig`** — `create/updateServerConfigs` can
  carry nested role `create`/`update`/`connect` on the tier relationships;
  `nestedRoleEscalation.ts` walks those and resolves `connect` targets from the
  DB so a tier role can't be escalated (e.g.
  `DefaultAdminRole.update.node.canManageAdmins = true`).
- **Channel role authoring** — `create*ChannelRoles` may grant a capability only
  for a channel the actor owns (or as server admin/root); channel roles carry no
  server-administration capability (`channelRoleEscalation.ts`).
- **Assignment** — role connections via `updateUsers` are blocked outright (the
  generic role-connect path is never legitimate); the invite flows grant fixed
  tier roles, so the inviter never chooses capabilities.

Root bypasses these checks; when the actor's own role can't be resolved, the
guards **fail closed**.

## Account-scoped and field-level access

Some access is **self-only** and does not flow through roles at all — there is no
"manage other users" capability:

- **`emails` enumeration is denied** for every caller (`Query.emails → deny`);
  only direct database access can read the email table. Clients that need the
  caller's own address use the self-scoped `getOwnEmail` query, which is *not*
  gated by `isAuthenticated` so it works during onboarding (it self-scopes via the
  token's verified email).
- **`updateUsers` / `deleteUsers` / `deleteEmails` are self-only** (`isAccountOwner`,
  with no admin override). Account edits/deletions are the user's own; cross-user
  admin action happens only through the invite/suspension flows. `updateUsers`
  additionally blocks connecting any role relationship (the
  privilege-escalation guard from #64).
- **Private `User` fields** (`Email`, notification settings, favorites,
  `Notifications`, purchases, …) are gated by `isAccountOwner`; public profile
  fields stay public.

## Suspension System

The suspension system enforces restrictions on users and moderators at both channel and server levels.

### Suspension Data Model

Suspensions are stored as `Suspension` nodes in the database with the following key properties:
- `suspendedUntil` - Date/time when the suspension expires (nullable)
- `suspendedIndefinitely` - Boolean flag for permanent suspensions
- `RelatedIssue` - Link to the moderation issue that triggered the suspension

Channels maintain relationships to active suspensions:
- `Channel.SuspendedUsers` - User suspensions for that channel
- `Channel.SuspendedMods` - Moderator suspensions for that channel

### Suspension Detection

The `getActiveSuspension` function (`rules/permission/getActiveSuspension.ts`) determines if a user or moderator has an active suspension:

1. **Active suspension criteria**: A suspension is considered active if:
   - `suspendedIndefinitely` is true, OR
   - `suspendedUntil` is in the future

2. **Expired suspension handling**: Expired suspensions are identified and returned to the caller for cleanup. The `disconnectExpiredSuspensions` function handles removing expired suspensions from channel relationships while preserving the `Suspension` nodes for historical records.

3. **Return value**: The function returns:
   - `isSuspended` - Whether the user/mod has an active suspension
   - `activeSuspension` - The suspension details (if any)
   - `relatedIssueId` - For linking to the moderation issue
   - `expiredUserSuspensions` / `expiredModSuspensions` - Lists of expired suspensions for cleanup
   - `suspendedEntity` - Whether it's a "user" or "mod" suspension

### Channel-Level Suspension Enforcement

Channel permissions (`hasChannelPermission.ts`, `hasChannelModPermission.ts`) enforce suspensions:

1. Check for active suspension using `getActiveSuspension`
2. If suspended, use the `SuspendedRole` (or `DefaultSuspendedRole` fallback) instead of normal roles
3. Check the requested permission against the suspended role
4. If blocked, create a notification explaining why (via `createSuspensionNotification`)
5. Clean up any expired suspensions in the background

### Server-Level Suspension Enforcement

Server permissions (`hasServerPermission.ts` for creative caps,
`hasServerModPermission.ts` for mod caps) also check for suspensions via
`getActiveServerSuspension`:

1. Query for any active server suspension (indefinite or unexpired)
2. If suspended, use `DefaultSuspendedRole` / `DefaultSuspendedModRole` instead of
   the tier role — **suspension takes precedence over tier**
3. This blocks suspended users from creating new channels/forums and suspended
   mods from server-level moderation

**Suspending an admin.** Server suspension (`scope: 'server'`) is the lever that
restricts a server admin. A server-suspended admin loses the admin override
everywhere — `passesAsServerAdminOrRoot` returns false, `hasServerModPermission`
stops short-circuiting on `isServerAdmin`, and they fall through to the suspended
role. **Root is the only actor a suspension cannot stop.** Channel-level roles do
not restrict an un-suspended admin — they are server staff.

### User Notifications

When a suspended user attempts a blocked action, `createSuspensionNotification` (`rules/permission/suspensionNotification.ts`):
- Creates an in-app notification explaining the block
- Includes the channel name, blocked permission, and related issue reference
- De-duplicates notifications to avoid spam (checks for existing unread notification with same text)

## Current Implementation Notes

- Roles are defined as nodes and wired to the `ServerConfig`/`Channel` tiers. The
  seeded defaults are the source of truth and are installed idempotently by
  `provisionServerDefaults` (`npm run provision`).
- Custom (non-default) roles **can** be created/edited through the role-authoring
  mutations (gated by `canManageRoles` + the no-privilege-escalation guards). A
  UI for managing them is still planned; today they are created via
  seed/provisioning/mutations.
- All permission checks are enforced through GraphQL Shield middleware combined
  with custom rule resolvers. The pure decision in each rule (given fetched roles,
  is this permission granted?) is separated from data fetching for unit testing.

## Permission Check Implementation

Permission checks span the channel and server scopes:

1. `hasChannelPermission.ts` - regular-user permissions for channel-specific actions
2. `hasChannelModPermission.ts` - moderator permissions for channel moderation
3. `hasServerPermission.ts` - server-wide creative/administration capabilities (tier resolution)
4. `hasServerModPermission.ts` - server-wide moderation capabilities

Supporting modules: `serverAdminOverride.ts` (server-admin/root override),
`actorCapabilities.ts` (resolves the actor's full effective role for the
no-escalation guards), `getActiveSuspension.ts`/`getActiveServerSuspension.ts`,
and the `rules/validation/*Escalation.ts` guards. Each channel/server pair shares
a similar flow but handles different role types.
