## Project Intro

An introduction to the project is in the frontend README: https://github.com/gennit-project/multiforum-frontend

## Technology Stack

On the backend (https://github.com/gennit-project/multiforum-backend), an Apollo server fetches data from the database (a graph database, Neo4j). Some resolvers are auto-generated using the [Neo4j graphql library](https://neo4j.com/docs/graphql/current/), while more complex resolvers are implemented using a combination of the [OGM](https://neo4j.com/docs/graphql/current/ogm/) and custom Cypher queries.

The frontend is a Vue application that makes GraphQL queries to the Apollo server.

## Permission System Architecture

Multiforum uses a comprehensive role-based permission system that governs what actions users can perform across the platform. The system operates at both server-wide and channel-specific levels.

### Permission Model Overview

The permission system uses the following components:

#### Types of Roles

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

#### User Classifications

- **Regular Users** - Standard platform users
- **Channel Owners** - Have administrative control over specific channels
- **Moderators** - Users with moderation capabilities
- **Suspended Users** - Users with temporarily restricted permissions

### How Permissions Are Applied

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

### Special Cases

- **Channel Owners** always have full permissions within their channels
- **Feedback Comments** require moderator permissions (`canGiveFeedback`) rather than standard comment permissions
- **Suspended Users** have limited permissions based on the Suspended roles

### Suspension System

The suspension system enforces restrictions on users and moderators at both channel and server levels.

#### Suspension Data Model

Suspensions are stored as `Suspension` nodes in the database with the following key properties:
- `suspendedUntil` - Date/time when the suspension expires (nullable)
- `suspendedIndefinitely` - Boolean flag for permanent suspensions
- `RelatedIssue` - Link to the moderation issue that triggered the suspension

Channels maintain relationships to active suspensions:
- `Channel.SuspendedUsers` - User suspensions for that channel
- `Channel.SuspendedMods` - Moderator suspensions for that channel

#### Suspension Detection

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

#### Channel-Level Suspension Enforcement

Channel permissions (`hasChannelPermission.ts`, `hasChannelModPermission.ts`) enforce suspensions:

1. Check for active suspension using `getActiveSuspension`
2. If suspended, use the `SuspendedRole` (or `DefaultSuspendedRole` fallback) instead of normal roles
3. Check the requested permission against the suspended role
4. If blocked, create a notification explaining why (via `createSuspensionNotification`)
5. Clean up any expired suspensions in the background

#### Server-Level Suspension Enforcement

Server permissions (`hasServerPermission.ts`) also check for suspensions:

1. Query for any active suspensions (indefinite or unexpired) across all channels
2. If any active suspension exists, use `DefaultSuspendedRole` for server-level actions
3. This blocks suspended users from creating new channels/forums

#### User Notifications

When a suspended user attempts a blocked action, `createSuspensionNotification` (`rules/permission/suspensionNotification.ts`):
- Creates an in-app notification explaining the block
- Includes the channel name, blocked permission, and related issue reference
- De-duplicates notifications to avoid spam (checks for existing unread notification with same text)

### Current Implementation Notes

- The ability to create customized channel roles (changing what is allowed for standard users or moderators in a given channel) is a planned feature but is not currently available
- Currently, the permissions are defined in the server configuration
- All permission checks are enforced through GraphQL Shield middleware combined with custom rule resolvers

### Permission Check Implementation

Permission checks are implemented in two main files:

1. `hasChannelPermission.ts` - Handles regular user permissions for channel-specific actions
2. `hasChannelModPermission.ts` - Handles moderator permissions for moderation actions

These files share a similar logical flow but handle different types of roles and permissions.

## Comment Notification System

The platform implements a real-time notification system for comments that alerts users when:
- Someone comments on their discussion
- Someone comments on their event
- Someone replies to their comment

### Technical Implementation

The notification system is implemented using Neo4j GraphQL's subscription feature, which leverages Neo4j's Change Data Capture (CDC) capabilities. This approach offers several advantages over middleware-based approaches:

1. **Reliability**: The system uses Neo4j's native CDC mechanism to capture comment creation events directly from the database, ensuring no events are missed even during high loads.

2. **Decoupling**: The notification system operates independently from the HTTP request/response cycle, allowing the comment creation API to remain fast and responsive.

3. **Resilience**: The subscription-based approach can recover from temporary failures and automatically reconnect to the event stream.

4. **Maintainability**: With clear separation of concerns, the notification logic is isolated in a dedicated service that's easier to test and update.

### How It Works

1. **Enabling Subscriptions**: The Neo4j GraphQL schema is extended with the `@subscription` directive, enabling subscription capabilities.

2. **CommentNotificationService**: A dedicated service class subscribes to the `commentCreated` event stream from Neo4j.

3. **Event Processing**: When a new comment is created, the service:
   - Receives the event with the new comment's basic information
   - Queries the database for the full comment details and related entities
   - Determines the notification type based on the comment context (discussion comment, event comment, or reply)
   - Identifies the user who should receive the notification
   - Generates both email and in-app notifications with appropriate links

4. **Notification Delivery**:
   - Email notifications are sent via SendGrid
   - In-app notifications are stored in the database and made available to users when they log in

### Notification Content

Notifications include:
- Who created the comment
- The content being commented on (discussion, event, or parent comment)
- The comment text
- A direct link to view the comment using the permalink format

This approach ensures users are promptly notified of new interactions with their content while maintaining system performance and scalability.

## Environment Variables and Running the App

I will fill out this section when the project is finished, or if someone expresses interest in collaborating on this project, whichever comes sooner. Anyone interested can contact me at catherine.luse@gmail.com.
