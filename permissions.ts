import { and, shield, allow, deny, or } from "graphql-shield";
import rules from "./rules/rules.js";

const {
  isRoot,
  canManageServerSettings,
  canManagePlugins,
  canManageRoles,
  canManageMods,
  canManageAdmins,
  canManageSuperAdmins,
  canRemoveDiscussionChannel,
  canRemoveEventChannel,
  canReportServerContent,
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
  serverRoleInputDoesNotEscalate,
  modServerRoleInputDoesNotEscalate,
  serverConfigInputDoesNotEscalate,
  channelRoleInputDoesNotEscalate,
  modChannelRoleInputDoesNotEscalate,
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
      dropDataForCypressTests: isRoot,
      seedDataForCypressTests: isRoot,
      createTags: and(isAuthenticated, allow),
      
      // Role management requires canManageRoles (the updateUsers role-connect
      // block still prevents self-escalation via assignment). The role-authoring
      // paths additionally enforce the no-privilege-escalation invariant: you
      // cannot author a role granting a capability you lack (e.g. a restricted
      // admin cannot mint canManageAdmins). For channel roles — which carry no
      // server-administration capability — the invariant is ownership: you may
      // author a capability-bearing channel role only for a channel you own (or
      // as server admin / root). See docs/isadmin-phaseout-design.md §5.
      createChannelRoles: and(isAuthenticated, canManageRoles, channelRoleInputDoesNotEscalate),
      createModChannelRoles: and(isAuthenticated, canManageRoles, modChannelRoleInputDoesNotEscalate),

      createModServerRoles: and(isAuthenticated, canManageRoles, modServerRoleInputDoesNotEscalate),
      createServerRoles: and(isAuthenticated, canManageRoles, serverRoleInputDoesNotEscalate),
      createServerConfigs: and(isAuthenticated, canManageServerSettings, serverConfigInputDoesNotEscalate),
      deleteServerConfigs: and(isAuthenticated, canManageServerSettings),

      // canManageServerSettings additionally must not be used to escalate a tier
      // role via a nested role create/update/connect (see §5 / PR-4b).
      updateServerConfigs: and(isAuthenticated, canManageServerSettings, serverConfigInputDoesNotEscalate),
      updateModServerRoles: and(isAuthenticated, canManageRoles, modServerRoleInputDoesNotEscalate),
      deleteChannelRoles: and(isAuthenticated, or(canManageRoles, isChannelOwner)),
      deleteServerRoles: and(isAuthenticated, canManageRoles),
      
      createEmailAndUser: allow, // Keep this as-is since this is for user registration
      // Self-only: a user may edit their own account, never another's. The
      // role-assignment fields are additionally blocked in the resolver to
      // prevent privilege escalation. Server admins do NOT get a blanket edit
      // over other users here (no isAdmin override) — account ownership is
      // self-scoped by design. See docs/isadmin-phaseout-design.md §8.4.
      updateUsers: and(isAuthenticated, updateUserInputIsValid, isAccountOwner),
      
      createChannels: and(isAuthenticated, createChannelInputIsValid, canCreateChannel),
      // Owner/admin for general channel-config updates; canEditWikiHomePage
      // additionally grants the wiki-home-page edit path (and now denies, rather
      // than blanket-allows, non-wiki updates — see evaluateCanEditWikiHomePageRule).
      updateChannels: and(isAuthenticated, updateChannelInputIsValid, or(isChannelOwner, canEditWikiHomePage)),
      deleteChannels: and(isAuthenticated, isChannelOwner),

      // Self-only by design (§8.2/§8.4): account deletion is self-scoped, never a
      // blanket admin power. isAccountOwner deliberately does NOT carry the
      // server-admin override. Cross-user admin actions happen through the
      // invite/suspension flows instead. See docs/isadmin-phaseout-design.md.
      deleteEmails: and(isAuthenticated, isAccountOwner),
      deleteUsers: and(isAuthenticated, isAccountOwner),
    
      createDiscussionWithChannelConnections: and(isAuthenticated, createDiscussionInputIsValid, canCreateDiscussion),
      updateDiscussionWithChannelConnections: and(isAuthenticated, updateDiscussionInputIsValid, or(isDiscussionOwner, canEditDiscussions)),
      deleteDiscussions: and(isAuthenticated, isDiscussionOwner),
      updateDiscussions: and(isAuthenticated, updateDiscussionInputIsValid, or(isDiscussionOwner, canEditDiscussions)),
      deleteDiscussionChannels: and(isAuthenticated, canRemoveDiscussionChannel),
      updateDiscussionChannels: and(isAuthenticated, isDiscussionChannelOwner),

      deleteTextVersions: deny,
      deleteCommentRevision: and(isAuthenticated, allow),
      deleteDiscussionBodyRevision: and(isAuthenticated, allow),
      deleteWikiRevision: and(isAuthenticated, allow),
      deleteWikiPages: and(isAuthenticated, canDeleteWikiPages),
      createWikiPages: and(isAuthenticated, canEditWikiPages),
      updateWikiPages: and(isAuthenticated, canEditWikiPages),
      
      createEventWithChannelConnections: and(isAuthenticated, createEventInputIsValid, canCreateEvent),
      updateEventWithChannelConnections: and(isAuthenticated, updateEventInputIsValid, or(isEventOwner, canEditEvents)),
      updateEvents: and(isAuthenticated, or(isEventOwner, canEditEvents)),
      deleteEvents: and(isAuthenticated, isEventOwner),
      deleteEventChannels: and(isAuthenticated, canRemoveEventChannel),

      createComments: and(isAuthenticated, createCommentInputIsValid, canCreateComment),
      updateComments: and(isAuthenticated, updateCommentInputIsValid, or(isCommentAuthor, canEditComments)),
      deleteComments: and(isAuthenticated, isCommentAuthor),
      
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
      deleteIssues: and(isAuthenticated, isIssueAuthor),
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
      updateAlbums: and(isAuthenticated, isAlbumOwner),
      deleteAlbums: and(isAuthenticated, isAlbumOwner),

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
      inviteServerAdmin: and(isAuthenticated, canManageAdmins),
      cancelInviteServerAdmin: and(isAuthenticated, canManageAdmins),
      acceptServerAdminInvite: and(isAuthenticated),
      inviteServerMod: and(isAuthenticated, canManageMods),
      cancelInviteServerMod: and(isAuthenticated, canManageMods),
      acceptServerModInvite: and(isAuthenticated),

      createNotifications: deny,
      deleteNotifications: deny,
      updateNotifications: deny,

      // Image edits (e.g. captions) are allowed for the uploader (OP) or an
      // image mod. canArchiveAndUnarchiveImage resolves to the server-level
      // canArchiveImage mod permission here, since updateImages carries no
      // channel argument and images aren't channel-scoped; server admins are
      // covered because the seeded admin bundle grants that mod capability.
      updateImages: and(isAuthenticated, or(isImageUploader, canArchiveAndUnarchiveImage)),
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
      reportProfilePicture: and(isAuthenticated, canReportServerContent), // server-scoped, no channel to scope canReport to
      lockChannel: and(isAuthenticated, canLockChannel),
      unlockChannel: and(isAuthenticated, canLockChannel),
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
      deleteFilterGroups: and(isAuthenticated, canManageServerSettings),
      deleteFilterOptions: and(isAuthenticated, canManageServerSettings),

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

      refreshPlugins: and(isAuthenticated, canManagePlugins),
      installPluginVersion: and(isAuthenticated, canManagePlugins),
      enableServerPlugin: and(isAuthenticated, canManagePlugins),
      setServerPluginSecret: and(isAuthenticated, canManagePlugins),
      deletePluginVersions: and(isAuthenticated, canManagePlugins),
      updateChannelPluginPipelines: and(isAuthenticated, isChannelOwner),
      updateDownloadLabels: and(isAuthenticated, allow), // Permission logic handled in resolver
    },
  },{
    debug: true,
    allowExternalErrors: true
  });
  
  
  export default permissionList;
  
