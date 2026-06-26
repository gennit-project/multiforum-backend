import { getPermissionRequestCache } from "./getPermissionRequestCache.js";
import type { GraphQLContext } from "../../types/context.js";

// All ServerRole capability fields, including the server-administration caps
// added for the isAdmin phase-out (docs/isadmin-phaseout-design.md).
const SERVER_ROLE_CAPS = `
  canCreateChannel
  canCreateDiscussion
  canCreateEvent
  canCreateComment
  canUpvoteComment
  canUpvoteDiscussion
  canUploadFile
  canGiveFeedback
  canManageServerSettings
  canManagePlugins
  canManageRoles
  canManageMods
  canManageAdmins
  canManageSuperAdmins
`;

export const getServerConfigForPermissions = async (context: GraphQLContext) => {
  const cache = getPermissionRequestCache(context);

  if (!cache.serverConfigPromise) {
    const ServerConfig = context.ogm.model("ServerConfig");
    cache.serverConfigPromise = ServerConfig.find({
      where: { serverName: process.env.SERVER_CONFIG_NAME },
      selectionSet: `{
        DefaultServerRole {
          ${SERVER_ROLE_CAPS}
        }
        DefaultSuspendedRole {
          ${SERVER_ROLE_CAPS}
        }
        DefaultAdminRole {
          ${SERVER_ROLE_CAPS}
        }
        DefaultSuperAdminRole {
          ${SERVER_ROLE_CAPS}
        }
        DefaultModRole {
          canOpenSupportTickets
          canLockChannel
          canCloseSupportTickets
          canGiveFeedback
          canHideComment
          canHideDiscussion
          canHideEvent
          canEditComments
          canEditDiscussions
          canEditEvents
          canReport
          canSuspendUser
          canArchiveImage
          canDeleteWiki
          canPermanentlyRemoveImage
        }
        DefaultElevatedModRole {
          canOpenSupportTickets
          canLockChannel
          canCloseSupportTickets
          canGiveFeedback
          canHideComment
          canHideDiscussion
          canHideEvent
          canEditComments
          canEditDiscussions
          canEditEvents
          canReport
          canSuspendUser
          canArchiveImage
          canDeleteWiki
          canPermanentlyRemoveImage
        }
        DefaultSuspendedModRole {
          canOpenSupportTickets
          canLockChannel
          canCloseSupportTickets
          canGiveFeedback
          canHideComment
          canHideDiscussion
          canHideEvent
          canEditComments
          canEditDiscussions
          canEditEvents
          canReport
          canSuspendUser
          canArchiveImage
          canDeleteWiki
          canPermanentlyRemoveImage
        }
        SuperAdmins {
          username
        }
        Admins {
          username
        }
        Moderators {
          displayName
        }
        SuspendedUsers {
          id
          username
          serverName
          suspendedUntil
          suspendedIndefinitely
          RelatedIssue {
            id
            issueNumber
          }
        }
        SuspendedMods {
          id
          modProfileName
          serverName
          suspendedUntil
          suspendedIndefinitely
          RelatedIssue {
            id
            issueNumber
          }
        }
      }`,
    }).then((serverConfigs: any[]) => serverConfigs?.[0] ?? null);
  }

  return cache.serverConfigPromise;
};
