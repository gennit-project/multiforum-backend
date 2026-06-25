import { and, shield, allow, deny, or } from "graphql-shield";
import rules from "./rules/rules.js";

const {
  isAdmin,
  isAccountOwner,
  isChannelOwner,
  isDiscussionOwner,
  isEventOwner,
  isCommentAuthor,
  isIssueAuthor,
  issueIsNotLocked,
  isDiscussionChannelOwner,
  canCreateChannel,
  canCreateDiscussion,
  canCreateEvent,
  canCreateComment,
  canUploadFile,
  canUpvoteComment,
  canUpvoteDiscussion,
  issueIsValid,
  createChannelInputIsValid,
  updateChannelInputIsValid,
  createDiscussionInputIsValid,
  updateDiscussionInputIsValid,
  createEventInputIsValid,
  updateEventInputIsValid,
  createCommentInputIsValid,
  updateCommentInputIsValid,
  createDownloadableFileInputIsValid,
  updateDownloadableFileInputIsValid,
  updateUserInputIsValid,
  canReport,
  canSuspendAndUnsuspendUser,
  canArchiveAndUnarchiveComment,
  canArchiveAndUnarchiveDiscussion,
  canArchiveAndUnarchiveEvent,
  canArchiveAndUnarchiveImage,
  canPermanentlyRemoveImage,
  canEditComments,
  canEditDiscussions,
  canEditEvents,
  isAuthenticatedAndVerified,
  isAuthenticated,
  canBecomeForumAdmin,
  canLockChannel,
  isCollectionOwner,
  isAlbumOwner,
  isImageUploader,
  canEditWikiPages,
  canDeleteWikiPages,
  canEditWikiHomePage,
} = rules;

const permissionList = shield({
    Query: {
      "*": allow,
      // Enumerating all emails is denied for every role — only direct database
      // access should be able to read them. Clients that need the caller's own
      // email use the self-scoped `getOwnEmail` query.
      emails: deny,
    },
    User: {
      // Public fields - anyone can access
      username: allow,
      displayName: allow,
      profilePicURL: allow,
      bio: allow,
      location: allow,
      pronouns: allow,
      createdAt: allow,
      commentKarma: allow,
      discussionKarma: allow,
      defaultEmojiSkinTone: allow,
      preferredTimeZone: allow,

      // Collection fields - custom resolver filters by visibility and ownership
      Collections: allow,
      FavoriteDiscussions: isAccountOwner,
      FavoriteComments: isAccountOwner,
      FavoriteDownloads: isAccountOwner,
      FavoriteImages: isAccountOwner,
      FavoriteChannels: isAccountOwner,
      OwnedDownloads: isAccountOwner,

      // Notifications - only the account owner may list their own notifications
      Notifications: isAccountOwner,

      // Other private fields
      Email: isAccountOwner,
      stripeAccountId: isAccountOwner,
      defaultLicense: isAccountOwner,
      purchases: isAccountOwner,
      library: isAccountOwner,

      // Sensitive settings - only user can access
      enableSensitiveContentByDefault: isAccountOwner,
      notifyOnReplyToCommentByDefault: isAccountOwner,
      notifyOnReplyToDiscussionByDefault: isAccountOwner,
      notifyOnReplyToEventByDefault: isAccountOwner,
      notifyWhenTagged: isAccountOwner,
      notifyOnSubscribedIssueUpdates: isAccountOwner,
      notifyOnFeedback: isAccountOwner,
      notificationBundleInterval: isAccountOwner,
      notificationBundleEnabled: isAccountOwner,
      notificationBundleContent: isAccountOwner,

      // Default rule for any unspecified fields - allow public access
      "*": allow,
    },
    Mutation: {
      "*": deny,
      dropDataForCypressTests: isAdmin,
      seedDataForCypressTests: isAdmin,
      createTags: and(isAuthenticated, allow),
      
      // Role-definition creation is admin-only: a non-admin who could create a
      // role (and then connect it to themselves via updateUsers) would be able
      // to self-escalate. updateUsers also blocks role-relationship connects.
      createChannelRoles: and(isAuthenticated, isAdmin),
      createModChannelRoles: and(isAuthenticated, isAdmin),

      createModServerRoles: and(isAuthenticated, isAdmin),
      createServerRoles: and(isAuthenticated, isAdmin),
      createServerConfigs: and(isAuthenticated, isAdmin),
      deleteServerConfigs: and(isAuthenticated, isAdmin),

      updateServerConfigs: and(isAuthenticated, isAdmin),
      updateModServerRoles: and(isAuthenticated, isAdmin),
      deleteChannelRoles: and(isAuthenticated, or(isAdmin, isChannelOwner)),
      deleteServerRoles: and(isAuthenticated, isAdmin),
      
      createEmailAndUser: allow, // Keep this as-is since this is for user registration
      updateUsers: and(isAuthenticated, updateUserInputIsValid, or(isAccountOwner, isAdmin)),
      
      createChannels: and(isAuthenticated, createChannelInputIsValid, canCreateChannel),
      // Owner/admin for general channel-config updates; canEditWikiHomePage
      // additionally grants the wiki-home-page edit path (and now denies, rather
      // than blanket-allows, non-wiki updates — see evaluateCanEditWikiHomePageRule).
      updateChannels: and(isAuthenticated, updateChannelInputIsValid, or(isChannelOwner, isAdmin, canEditWikiHomePage)),
      deleteChannels: and(isAuthenticated, or(isAdmin, isChannelOwner)),

      deleteEmails: and(isAuthenticated, or(isAccountOwner, isAdmin)),
      deleteUsers: and(isAuthenticated, or(isAdmin, isAccountOwner)),
    
      createDiscussionWithChannelConnections: and(isAuthenticated, createDiscussionInputIsValid, or(canCreateDiscussion, isAdmin)),
      updateDiscussionWithChannelConnections: and(isAuthenticated, updateDiscussionInputIsValid, or(isDiscussionOwner, isAdmin, canEditDiscussions)),
      deleteDiscussions: and(isAuthenticated, or(isAdmin, isDiscussionOwner)),
      updateDiscussions: and(isAuthenticated, updateDiscussionInputIsValid, or(isAdmin, isDiscussionOwner, canEditDiscussions)),
      deleteDiscussionChannels: and(isAuthenticated, isAdmin),
      updateDiscussionChannels: and(isAuthenticated, or(isAdmin, isDiscussionChannelOwner)),

      deleteTextVersions: deny,
      deleteCommentRevision: and(isAuthenticated, allow),
      deleteDiscussionBodyRevision: and(isAuthenticated, allow),
      deleteWikiRevision: and(isAuthenticated, allow),
      deleteWikiPages: and(isAuthenticated, or(isAdmin, canDeleteWikiPages)),
      createWikiPages: and(isAuthenticated, canEditWikiPages),
      updateWikiPages: and(isAuthenticated, canEditWikiPages),
      
      createEventWithChannelConnections: and(isAuthenticated, createEventInputIsValid, canCreateEvent),
      updateEventWithChannelConnections: and(isAuthenticated, updateEventInputIsValid, or(isEventOwner, isAdmin, canEditEvents)),
      updateEvents: and(isAuthenticated, or(isAdmin, isEventOwner, canEditEvents)),
      deleteEvents: and(isAuthenticated, or(isAdmin, isEventOwner)),
      deleteEventChannels: and(isAuthenticated, isAdmin),

      createComments: and(isAuthenticated, createCommentInputIsValid, canCreateComment),
      updateComments: and(isAuthenticated, updateCommentInputIsValid, or(isCommentAuthor, isAdmin, canEditComments)),
      deleteComments: and(isAuthenticated, or(isAdmin, isCommentAuthor)),
      
      createSignedStorageURL: and(isAuthenticated, canUploadFile),
      addEmojiToComment: and(isAuthenticated, canUpvoteComment),
      removeEmojiFromComment: and(isAuthenticated, canUpvoteComment),
      addEmojiToDiscussionChannel: and(isAuthenticated, canUpvoteDiscussion),
      removeEmojiFromDiscussionChannel: and(isAuthenticated, canUpvoteDiscussion),
      upvoteComment: and(isAuthenticated, canUpvoteComment),
      undoUpvoteComment: and(isAuthenticated, canUpvoteComment), // We are intentionally reusing the same rule for undoing an upvote as for upvoting.
      // Any user who can upvote a comment can undo their upvote. The undo upvote resolver 
      // checks if the user has upvoted the comment and if so, removes the upvote.

      upvoteDiscussionChannel: and(isAuthenticated, canUpvoteDiscussion),
      undoUpvoteDiscussionChannel: and(isAuthenticated, canUpvoteDiscussion), // We are intentionally reusing the same rule for undoing an upvote as for upvoting.
      // Any user who can upvote a discussion can undo their upvote. The undo upvote resolver
      // checks if the user has upvoted the discussion and if so, removes the upvote.

      createScratchpadEntry: and(isAuthenticated, allow), // Super upvote - any authenticated user can send a thank-you note
      undoSuperUpvote: and(isAuthenticated, allow), // Undo super upvote - any authenticated user can undo their super upvote
      
      createIssue: and(isAuthenticated, issueIsValid),
      createIssues: and(isAuthenticated, issueIsValid),
      // Issue deletion restricted to a server admin or the issue's own author
      // (isIssueAuthor resolves the issue from where.id and matches User or
      // ModerationProfile authorship). Previously any authenticated user could
      // delete any moderation issue, e.g. a report filed against themselves.
      deleteIssues: and(isAuthenticated, or(isAdmin, isIssueAuthor)),
      // Issue updates (close/reopen) can be done by:
      // 1. Channel owners (always)
      // 2. Issue author (if issue is not locked)
      // 3. Moderators with archive permissions
      updateIssues: and(
        isAuthenticated,
        or(
          isChannelOwner,
          and(isIssueAuthor, issueIsNotLocked),
          canArchiveAndUnarchiveDiscussion
        )
      ),

      createAlbums: and(isAuthenticated, allow), // Owner forced server-side in createAlbumsWithOwner
      updateAlbums: and(isAuthenticated, or(isAlbumOwner, isAdmin)),
      deleteAlbums: and(isAuthenticated, or(isAlbumOwner, isAdmin)),

      inviteForumOwner: and(isAuthenticated, isChannelOwner),
      cancelInviteForumOwner: and(isAuthenticated, isChannelOwner),
      removeForumOwner: and(isAuthenticated, isChannelOwner),
      acceptForumOwnerInvite: and(isAuthenticated),
      becomeForumAdmin: and(isAuthenticated, canBecomeForumAdmin),
      inviteForumMod: and(isAuthenticated, isChannelOwner),
      cancelInviteForumMod: and(isAuthenticated, isChannelOwner),
      removeForumMod: and(isAuthenticated, isChannelOwner),
      acceptForumModInvite: and(isAuthenticated),

      // Server admin/mod invite workflow
      inviteServerAdmin: and(isAuthenticated, isAdmin),
      cancelInviteServerAdmin: and(isAuthenticated, isAdmin),
      acceptServerAdminInvite: and(isAuthenticated),
      inviteServerMod: and(isAuthenticated, isAdmin),
      cancelInviteServerMod: and(isAuthenticated, isAdmin),
      acceptServerModInvite: and(isAuthenticated),

      createNotifications: deny,
      deleteNotifications: deny,
      updateNotifications: deny,

      // Image edits (e.g. captions) are allowed for the uploader (OP), an
      // image mod, or an admin. canArchiveAndUnarchiveImage resolves to the
      // server-level canArchiveImage mod permission here, since updateImages
      // carries no channel argument and images aren't channel-scoped.
      updateImages: and(isAuthenticated, or(isImageUploader, canArchiveAndUnarchiveImage, isAdmin)),
      createImages: deny, // Use createImageWithUploader instead to ensure Uploader is set
      createImageWithUploader: and(isAuthenticated, canUploadFile),

      createDownloadableFiles: and(isAuthenticated, createDownloadableFileInputIsValid, canUploadFile),
      updateDownloadableFiles: and(isAuthenticated, updateDownloadableFileInputIsValid, canUploadFile),
      deleteDownloadableFiles: and(isAuthenticated, canUploadFile),

      reportDiscussion: and(isAuthenticated, or(isChannelOwner, canReport)),
      reportComment: and(isAuthenticated, or(isChannelOwner, canReport)),
      reportEvent: and(isAuthenticated, or(isChannelOwner, canReport)),
      reportWikiEdit: and(isAuthenticated, or(isChannelOwner, canReport)),
      reportChannel: and(isAuthenticated, canReport), // Channel reports require mod profile, no channel owner shortcut
      reportImage: and(isAuthenticated, or(isChannelOwner, canReport)), // mirrors reportComment/reportDiscussion (channel-scoped image content)
      reportChannelImage: and(isAuthenticated, canReport), // server-scoped, but canReport resolves the channel from channelUniqueName (like reportChannel)
      reportProfilePicture: and(isAuthenticated, isAdmin), // server-scoped, no channel to scope canReport to
      lockChannel: and(isAuthenticated, or(isAdmin, canLockChannel)),
      unlockChannel: and(isAuthenticated, or(isAdmin, canLockChannel)),
      suspendMod: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      suspendUser: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      unsuspendMod: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      unsuspendUser: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      lockIssue: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      unlockIssue: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      archiveComment: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveComment)),
      archiveDiscussion: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      archiveEvent: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveEvent)),
      unarchiveComment: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveComment)),
      unarchiveDiscussion: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      unarchiveEvent: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveEvent)),
      archiveImage: and(isAuthenticated, canArchiveAndUnarchiveImage),
      unarchiveImage: and(isAuthenticated, canArchiveAndUnarchiveImage),
      permanentlyRemoveImage: and(isAuthenticated, canPermanentlyRemoveImage),

      subscribeToDiscussionChannel: and(isAuthenticated, allow),
      unsubscribeFromDiscussionChannel: and(isAuthenticated, allow),
      subscribeToEvent: and(isAuthenticated, allow),
      unsubscribeFromEvent: and(isAuthenticated, allow),
      subscribeToEventUpdates: and(isAuthenticated, allow),
      unsubscribeFromEventUpdates: and(isAuthenticated, allow),
      subscribeToComment: and(isAuthenticated, allow),
      unsubscribeFromComment: and(isAuthenticated, allow),
      subscribeToIssue: and(isAuthenticated, allow),
      unsubscribeFromIssue: and(isAuthenticated, allow),
      sendBugReport: allow, // Allow non-authenticated users to send bug reports

      // Standalone filter-config deletes (not used by the app; filters are
      // managed via nested channel updates). Were bare `allow` — unauthenticated
      // anyone could delete them. Restricted to admins.
      deleteFilterGroups: and(isAuthenticated, isAdmin),
      deleteFilterOptions: and(isAuthenticated, isAdmin),

      // Collection mutations - authenticated users only
      createCollections: and(isAuthenticated, allow),
      updateCollections: and(isAuthenticated, isCollectionOwner),
      addToCollection: and(isAuthenticated, isCollectionOwner),
      deleteCollections: and(isAuthenticated, isCollectionOwner),
      removeFromCollection: and(isAuthenticated, isCollectionOwner),
      reorderCollectionItem: and(isAuthenticated, isCollectionOwner),
      toggleBookmark: and(isAuthenticated, allow),
      addToFavorites: and(isAuthenticated, allow),
      shareCollectionAsDiscussion: and(isAuthenticated, isCollectionOwner),
      addToOwnedDownloads: and(isAuthenticated, allow),
      initializeUserFavorites: and(isAuthenticated, allow),

      refreshPlugins: and(isAuthenticated, isAdmin),
      installPluginVersion: and(isAuthenticated, isAdmin),
      enableServerPlugin: and(isAuthenticated, isAdmin),
      setServerPluginSecret: and(isAuthenticated, isAdmin),
      deletePluginVersions: and(isAuthenticated, isAdmin), // was bare `allow` (unauthenticated delete)
      updateChannelPluginPipelines: and(isAuthenticated, isChannelOwner),
      updateDownloadLabels: and(isAuthenticated, allow), // Permission logic handled in resolver
    },
  },{
    debug: true,
    allowExternalErrors: true
  });
  
  
  export default permissionList;
  
