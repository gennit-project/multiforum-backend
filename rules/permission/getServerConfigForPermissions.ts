import { getPermissionRequestCache } from "./getPermissionRequestCache.js";
import type { GraphQLContext } from "../../types/context.js";

export const getServerConfigForPermissions = async (context: GraphQLContext) => {
  const cache = getPermissionRequestCache(context);

  if (!cache.serverConfigPromise) {
    const ServerConfig = context.ogm.model("ServerConfig");
    cache.serverConfigPromise = ServerConfig.find({
      where: { serverName: process.env.SERVER_CONFIG_NAME },
      selectionSet: `{
        DefaultServerRole {
          canCreateChannel
          canCreateDiscussion
          canCreateEvent
          canCreateComment
          canUpvoteComment
          canUpvoteDiscussion
          canUploadFile
        }
        DefaultSuspendedRole {
          canCreateChannel
          canCreateDiscussion
          canCreateEvent
          canCreateComment
          canUpvoteComment
          canUpvoteDiscussion
          canUploadFile
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
