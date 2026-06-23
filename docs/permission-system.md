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

## How Permissions Are Applied

The permission system follows a hierarchical flow:

1. **Authentication Check**
   - Verifies that the user is logged in and their JWT is valid

2. **Role Determination**
   - For each action, the system determines which role applies to the user
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

- **Channel Owners** always have full permissions within their channels
- **Feedback Comments** require moderator permissions (`canGiveFeedback`) rather than standard comment permissions
- **Suspended Users** have limited permissions based on the Suspended roles

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

Server permissions (`hasServerPermission.ts`) also check for suspensions:

1. Query for any active suspensions (indefinite or unexpired) across all channels
2. If any active suspension exists, use `DefaultSuspendedRole` for server-level actions
3. This blocks suspended users from creating new channels/forums

### User Notifications

When a suspended user attempts a blocked action, `createSuspensionNotification` (`rules/permission/suspensionNotification.ts`):
- Creates an in-app notification explaining the block
- Includes the channel name, blocked permission, and related issue reference
- De-duplicates notifications to avoid spam (checks for existing unread notification with same text)

## Current Implementation Notes

- The ability to create customized channel roles (changing what is allowed for standard users or moderators in a given channel) is a planned feature but is not currently available
- Currently, the permissions are defined in the server configuration
- All permission checks are enforced through GraphQL Shield middleware combined with custom rule resolvers

## Permission Check Implementation

Permission checks are implemented in two main files:

1. `hasChannelPermission.ts` - Handles regular user permissions for channel-specific actions
2. `hasChannelModPermission.ts` - Handles moderator permissions for moderation actions

These files share a similar logical flow but handle different types of roles and permissions.
