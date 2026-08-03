import { isIntrospectionType, isObjectType } from "graphql";
import { middleware } from "graphql-middleware";
import { and, chain, shield, allow, deny, or, type IRules } from "graphql-shield";
import rules from "./rules/rules.js";
import typeDefs from "./typeDefs.js";

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
  canSuperUpvote,
  issueIsValid,
  createChannelInputIsValid,
  updateChannelInputIsValid,
  createDiscussionInputIsValid,
  updateDiscussionInputIsValid,
  serverDownloadsEnabled,
  createEventInputIsValid,
  updateEventInputIsValid,
  createCommentInputIsValid,
  updateCommentInputIsValid,
  createDownloadableFileInputIsValid,
  updateDownloadableFileInputIsValid,
  updateImageInputIsValid,
  updateUserInputIsValid,
  serverRoleInputDoesNotEscalate,
  modServerRoleInputDoesNotEscalate,
  serverConfigInputDoesNotEscalate,
  channelRoleInputDoesNotEscalate,
  modChannelRoleInputDoesNotEscalate,
  canReport,
  canSuspendAndUnsuspendUser,
  canArchiveAndUnarchiveComment,
  canStickyComment,
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

// These application-defined output types are intentionally readable. Keeping
// this list explicit means a newly added schema type is denied by Shield's
// fallback until its public surface has been reviewed and added here.
const PUBLIC_READ_TYPES = [
  "Activity",
  "Album",
  "ApplicablePluginPipeline",
  "Channel",
  "ChannelDiscussionFlairConfig",
  "ChannelHealthRow",
  "ChannelInfo",
  "ChannelPluginProperties",
  "ChannelRole",
  "Collection",
  "Comment",
  "CommentAggregateResult",
  "CommentInfo",
  "CommentRepliesFormat",
  "CommentSectionFormat",
  "Contact",
  "DayData",
  "DeleteEventInSeriesResult",
  "Discussion",
  "DiscussionChannel",
  "DiscussionChannelInfo",
  "DiscussionChannelListFormat",
  "DiscussionChannelListItem",
  "DiscussionFlair",
  "DiscussionFlairOption",
  "DiscussionInfo",
  "DownloadScanReviewItem",
  "DownloadableFile",
  "DropDataResponse",
  "Emoji",
  "EnvironmentInfo",
  "Event",
  "EventChannel",
  "EventChannelInfo",
  "EventCommentsFormat",
  "EventInfo",
  "EventSeries",
  "Feed",
  "FileVersion",
  "FilterGroup",
  "FilterOption",
  "GetSortedChannelsResponse",
  "HotRankingSettings",
  "Image",
  "ImageAlbumUsage",
  "InstallationProperties",
  "InstalledPlugin",
  "InternalPluginPipelineRunDetail",
  "Issue",
  "IssueAgingBucket",
  "IssueInfo",
  "LabelChangeHistory",
  "License",
  "LinkFlair",
  "Message",
  "ModActivity",
  "ModChannelRole",
  "ModDayData",
  "ModServerRole",
  "ModerationAction",
  "Notification",
  "OwnEmail",
  "PipelineStep",
  "Plugin",
  "PluginConfigFieldStatus",
  "PluginConfigStatus",
  "PluginPipelineCampaign",
  "PluginPipelineCampaignFailure",
  "PluginPipelineCampaignPreview",
  "PluginPipelineSummary",
  "PluginSecretStatus",
  "PluginVersion",
  "PrepareDownloadResult",
  "PublicExpectedPluginJob",
  "PublicPluginDiagnostic",
  "PublicPluginJobRun",
  "PublicPluginPipelineRun",
  "Purchase",
  "RankingSettings",
  "RecurringEvent",
  "RepeatEnds",
  "RepeatEvery",
  "RepeatPattern",
  "SafetyCheckResponse",
  "ScratchpadEntry",
  "SeedDataResponse",
  "ServerConfig",
  "ServerHealthAttentionItem",
  "ServerHealthDashboard",
  "ServerHealthSummary",
  "ServerHealthTimeSeriesPoint",
  "ServerRole",
  "ServerSecret",
  "SignedURL",
  "SiteWideDiscussionListFormat",
  "SiteWideDiscussionListItem",
  "SiteWideIssueListFormat",
  "SiteWideIssueListItem",
  "SiteWideWikiListFormat",
  "Suspension",
  "Tag",
  "TextVersion",
  "UndoSuperUpvoteResult",
  "UploadedDownloadableFileDiscussion",
  "UploadedDownloadableFileGroup",
  "UserAggregateResult",
  "UserContributionData",
  "WikiEditInfo",
  "WikiPage",
  "WikiPageInfo",
] as const;

const publicReadRules = Object.fromEntries(
  PUBLIC_READ_TYPES.map((typeName) => [typeName, { "*": allow }])
);

const declaredObjectTypes = new Set(
  typeDefs.definitions
    .filter((definition) => definition.kind === "ObjectTypeDefinition")
    .map((definition) => definition.name.value)
);

const permissionRules: IRules = {
    ...publicReadRules,
    Query: {
      "*": allow,
      // Enumerating all emails is denied for every role — only direct database
      // access should be able to read them. Clients that need the caller's own
      // email use the self-scoped `getOwnEmail` query.
      emails: deny,
      getUploadedDownloadableFiles: and(isAuthenticated, allow),
      getServerHealthDashboard: and(isAuthenticated, canManageMods),
      getDownloadScanReviewQueue: and(isAuthenticated, canPermanentlyRemoveImage),
      getPluginConfigStatus: and(isAuthenticated, canManagePlugins),
      getPluginRunsForDownloadableFile: chain(
        isAuthenticated,
        canManagePlugins
      ),
      getPipelineRuns: chain(isAuthenticated, canManagePlugins),
      getInternalPluginPipelineRun: chain(
        isAuthenticated,
        canManagePlugins
      ),
      previewPluginPipelineCampaign: chain(isAuthenticated, canManagePlugins),
      getPluginPipelineCampaigns: chain(isAuthenticated, canManagePlugins),
      getPluginPipelineCampaignFailures: chain(isAuthenticated, canManagePlugins),
      pluginRuns: deny,
      pluginRunsAggregate: deny,
      pluginPipelineRuns: deny,
      pluginPipelineRunsAggregate: deny,
      getRankingSettings: and(isAuthenticated, canManageServerSettings),
    },
    PluginRun: {
      payload: chain(isAuthenticated, canManagePlugins),
      publicDiagnostics: chain(isAuthenticated, canManagePlugins),
      "*": allow,
    },
    PluginPipelineRun: {
      configurationSnapshot: chain(isAuthenticated, canManagePlugins),
      "*": allow,
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

      // Moderation profiles are pseudonymous by design: their activity/history
      // is public for transparency, but the link to the real account (username,
      // email) must not be discoverable through the API. Only the account owner
      // may traverse their own User -> ModerationProfile edge (e.g. to learn
      // their own mod-profile name); nobody can look up someone else's. There is
      // deliberately no admin override — if an admin truly needs the mapping
      // they must run a direct database query. See ModerationProfile.User below,
      // which blocks the reverse (mod profile -> user) direction outright.
      ModerationProfile: isAccountOwner,

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

      // Fields intentionally public under the previous fallback behavior.
      Albums: allow,
      Images: allow,
      isBot: allow,
      botProfileId: allow,
      isDeprecated: allow,
      deprecatedReason: allow,
      Comments: allow,
      Discussions: allow,
      Events: allow,
      AdminOfChannels: allow,
      ModOfChannels: allow,
      AdminOfServers: allow,
      RecentlyVisitedChannels: allow,
      UpvotedComments: allow,
      UpvotedDiscussionChannels: allow,
      Suspensions: allow,
      AuthoredWikiPages: allow,
      OriginalWikiPages: allow,
      AuthoredWikiPageVersions: allow,
      ChannelRoles: allow,
      ServerRoles: allow,
      ModChannelRoles: allow,
      ModServerRoles: allow,
      PendingModInvites: allow,
      PendingOwnerInvites: allow,
      PendingServerAdminInvites: allow,
      PendingServerModInvites: allow,
      deleted: allow,
      notifyOnSuspensionBlocks: allow,
      ScratchpadEntries: allow,
      WrittenScratchpadEntries: allow,
    },
    ModerationProfile: {
      // The reverse of User.ModerationProfile: a mod profile must never resolve
      // back to the user behind it. No client or resolver traverses this edge;
      // an admin who genuinely needs the mapping must use a direct DB query.
      // Denied for everyone (including the account owner) — the pseudonymous
      // identity is one-way from the API's perspective.
      User: deny,
      // Everything else currently on a moderation profile is public for
      // transparency and audit. Enumerating these fields ensures a future
      // identity-bearing edge does not silently inherit an allow wildcard.
      createdAt: allow,
      displayName: allow,
      AuthoredIssues: allow,
      AuthoredComments: allow,
      ModChannelRoles: allow,
      ModServerRoles: allow,
      ModOfServers: allow,
      ActivityFeed: allow,
      Suspensions: allow,
    },
    Email: {
      // Access to an Email node is already restricted at Query.emails and
      // User.Email. Enumerate its current fields so future identity fields do
      // not inherit a broad allow wildcard.
      address: allow,
      User: allow,
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
    
      createDiscussionWithChannelConnections: and(isAuthenticated, createDiscussionInputIsValid, canCreateDiscussion, serverDownloadsEnabled),
      updateDiscussionWithChannelConnections: and(isAuthenticated, updateDiscussionInputIsValid, or(isDiscussionOwner, canEditDiscussions)),
      deleteDiscussions: and(isAuthenticated, isDiscussionOwner),
      updateDiscussions: and(isAuthenticated, updateDiscussionInputIsValid, or(isDiscussionOwner, canEditDiscussions)),
      deleteDiscussionChannels: and(isAuthenticated, canRemoveDiscussionChannel),
      updateDiscussionChannels: and(isAuthenticated, isDiscussionChannelOwner),

      deleteTextVersions: deny,
      deleteCommentRevision: and(isAuthenticated, allow),
      deleteDiscussionBodyRevision: and(isAuthenticated, allow),
      deleteEventDescriptionRevision: and(isAuthenticated, allow),
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

      createScratchpadEntry: and(isAuthenticated, canSuperUpvote), // Super upvote requires the same channel permission as a normal upvote (blocks suspended users)
      undoSuperUpvote: and(isAuthenticated, canSuperUpvote), // Reuse the same rule for undoing a super upvote
      
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
      updateImages: and(isAuthenticated, updateImageInputIsValid, or(isImageUploader, canArchiveAndUnarchiveImage)),
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
      lockWikiPage: and(isAuthenticated, allow),
      unlockWikiPage: and(isAuthenticated, allow),
      setFeaturedWikiPages: and(isAuthenticated, canManageServerSettings),
      setRankingSettings: and(isAuthenticated, canManageServerSettings),
      setChannelDiscussionFlairConfig: and(isAuthenticated, isChannelOwner),
      suspendMod: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      suspendUser: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      unsuspendMod: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      unsuspendUser: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      lockIssue: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      unlockIssue: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      archiveComment: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveComment)),
      stickyComment: and(isAuthenticated, or(isChannelOwner, canStickyComment)),
      unstickyComment: and(isAuthenticated, or(isChannelOwner, canStickyComment)),
      archiveDiscussion: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      archiveEvent: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveEvent)),
      unarchiveComment: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveComment)),
      unarchiveDiscussion: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      unarchiveEvent: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveEvent)),
      archiveImage: and(isAuthenticated, canArchiveAndUnarchiveImage),
      unarchiveImage: and(isAuthenticated, canArchiveAndUnarchiveImage),
      permanentlyRemoveImage: and(isAuthenticated, canPermanentlyRemoveImage),
      retryDownloadableFileScan: and(isAuthenticated, allow),
      startPluginPipeline: and(isAuthenticated, allow),
      rerunPluginPipeline: and(isAuthenticated, allow),
      createPluginPipelineCampaign: and(isAuthenticated, canManagePlugins),
      pausePluginPipelineCampaign: and(isAuthenticated, canManagePlugins),
      resumePluginPipelineCampaign: and(isAuthenticated, canManagePlugins),
      clearDownloadableFileScan: and(isAuthenticated, canPermanentlyRemoveImage),
      requestDownloadableFileReview: and(isAuthenticated, allow),
      permanentlyDeleteImage: and(isAuthenticated, allow),
      permanentlyDeleteDownloadableFile: and(isAuthenticated, allow),

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
      shareCollectionAsDiscussion: and(isAuthenticated, isCollectionOwner),

      refreshPlugins: and(isAuthenticated, canManagePlugins),
      installPluginVersion: and(isAuthenticated, canManagePlugins),
      enableServerPlugin: and(isAuthenticated, canManagePlugins),
      setServerPluginSecret: and(isAuthenticated, canManagePlugins),
      deletePluginVersions: and(isAuthenticated, canManagePlugins),
      updateChannelPluginPipelines: and(isAuthenticated, isChannelOwner),
      updateDownloadLabels: and(isAuthenticated, allow), // Permission logic handled in resolver
    },
  };

// Neo4j GraphQL creates connection, edge, aggregate, and mutation-response
// object types around the application types. They do not introduce independent
// data access: access is already controlled at Query/Mutation and at the
// application-defined relationship field. Allow those generated wrappers so
// existing connection/aggregate queries continue to work with a deny fallback.
const permissionList = middleware((schema) => {
  const generatedTypeRules = Object.fromEntries(
    Object.values(schema.getTypeMap())
      .filter(
        (type) =>
          isObjectType(type) &&
          !isIntrospectionType(type) &&
          !declaredObjectTypes.has(type.name)
      )
      .map((type) => [type.name, { "*": allow }])
  );

  return shield(
    {
      ...generatedTypeRules,
      ...permissionRules,
    },
    {
      debug: true,
      allowExternalErrors: true,
      fallbackRule: deny,
    }
  ).generate(schema);
});
  
  
  export default permissionList;
  
