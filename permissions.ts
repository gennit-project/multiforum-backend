import { and, shield, allow, deny, or } from "graphql-shield";
import rules from "./rules/rules.js";

const {
  isAdmin,
  isAccountOwner,
  isChannelOwner,
  isDiscussionOwner,
  isEventOwner,
  isCommentAuthor,
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
  canReport,
  canSuspendAndUnsuspendUser,
  canArchiveAndUnarchiveComment,
  canArchiveAndUnarchiveDiscussion,
  canArchiveAndUnarchiveEvent,
  isAuthenticatedAndVerified,
  isAuthenticated,
  canBecomeForumAdmin,
} = rules;

const permissionList = shield({
    Query: {
      "*": allow,
      emails: allow// isAdmin,
    },
    Mutation: {
      "*": deny,
      dropDataForCypressTests: isAdmin,
      seedDataForCypressTests: isAdmin,
      createTags: and(isAuthenticated, allow),
      
      createChannelRoles: and(isAuthenticated, allow),//isAdmin,
      createModChannelRoles: and(isAuthenticated, allow),//isAdmin,

      createModServerRoles: and(isAuthenticated, allow),//isAdmin,
      createServerRoles: and(isAuthenticated, allow),//isAdmin,
      createServerConfigs: and(isAuthenticated, isAdmin),
      deleteServerConfigs: and(isAuthenticated, isAdmin),

      updateServerConfigs: and(isAuthenticated, allow),//isAdmin,
      updateModServerRoles: and(isAuthenticated, isAdmin),
      deleteChannelRoles: and(isAuthenticated, or(isAdmin, isChannelOwner)),
      deleteServerRoles: and(isAuthenticated, isAdmin),
      
      createEmailAndUser: allow, // Keep this as-is since this is for user registration
      updateUsers: and(isAuthenticated, or(isAccountOwner, isAdmin)),
      
      createChannels: and(isAuthenticated, createChannelInputIsValid, canCreateChannel),
      updateChannels:allow,// and(isAuthenticated, updateChannelInputIsValid, or(isChannelOwner, isAdmin)),
      deleteChannels: and(isAuthenticated, or(isAdmin, isChannelOwner)),

      deleteEmails: and(isAuthenticated, or(isAccountOwner, isAdmin)),
      deleteUsers: and(isAuthenticated, or(isAdmin, isAccountOwner)),
    
      createDiscussionWithChannelConnections: and(isAuthenticated, createDiscussionInputIsValid, or(canCreateDiscussion, isAdmin)),
      updateDiscussionWithChannelConnections: and(isAuthenticated, updateDiscussionInputIsValid, or(isDiscussionOwner, isAdmin)),
      deleteDiscussions: and(isAuthenticated, or(isAdmin, isDiscussionOwner)),
      updateDiscussions: and(isAuthenticated, or(isAdmin, isDiscussionOwner)),
      deleteDiscussionChannels: and(isAuthenticated, isAdmin),
      updateDiscussionChannels: and(isAuthenticated, or(isAdmin, isDiscussionChannelOwner)),

      deleteTextVersions: and(isAuthenticated, allow),
      createWikiPages: and(isAuthenticated, allow),
      updateWikiPages: and(isAuthenticated, allow),
      
      createEventWithChannelConnections: and(isAuthenticated, createEventInputIsValid, canCreateEvent),
      updateEventWithChannelConnections: and(isAuthenticated, updateEventInputIsValid, or(isEventOwner, isAdmin)),
      updateEvents: and(isAuthenticated, or(isAdmin, isEventOwner)),
      deleteEvents: and(isAuthenticated, or(isAdmin, isEventOwner)),
      deleteEventChannels: and(isAuthenticated, isAdmin),

      createComments: and(isAuthenticated, createCommentInputIsValid, canCreateComment),
      updateComments: and(isAuthenticated, updateCommentInputIsValid, or(isCommentAuthor, isAdmin)),
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
      
      createIssues: and(isAuthenticated, issueIsValid),
      deleteIssues: and(isAuthenticated, allow), // canDeleteIssues,
      updateIssues: and(isAuthenticated, allow), // canUpdateIssues,

      createAlbums: and(isAuthenticated, allow),
      updateAlbums: and(isAuthenticated, allow),
      deleteAlbums: and(isAuthenticated, allow),

      inviteForumOwner: and(isAuthenticated, isChannelOwner),
      cancelInviteForumOwner: and(isAuthenticated, isChannelOwner),
      removeForumOwner: and(isAuthenticated, isChannelOwner),
      acceptForumOwnerInvite: and(isAuthenticated),
      becomeForumAdmin: and(isAuthenticated, canBecomeForumAdmin),
      inviteForumMod: and(isAuthenticated, isChannelOwner),
      cancelInviteForumMod: and(isAuthenticated, isChannelOwner),
      removeForumMod: and(isAuthenticated, isChannelOwner),
      acceptForumModInvite: and(isAuthenticated),

      createNotifications: deny,
      deleteNotifications: deny,
      updateNotifications: deny,

      updateImages: and(isAuthenticated, allow),
      createImages: and(isAuthenticated, allow),

      createDownloadableFiles: and(isAuthenticated, createDownloadableFileInputIsValid, canUploadFile),
      updateDownloadableFiles: and(isAuthenticated, updateDownloadableFileInputIsValid, canUploadFile),
      deleteDownloadableFiles: and(isAuthenticated, canUploadFile),

      reportDiscussion: and(isAuthenticated, or(isChannelOwner, canReport)),
      reportComment: and(isAuthenticated, or(isChannelOwner, canReport)),
      reportEvent: and(isAuthenticated, or(isChannelOwner, canReport)),
      suspendMod: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      suspendUser: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      unsuspendMod: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      unsuspendUser: and(isAuthenticated, or(isChannelOwner, canSuspendAndUnsuspendUser)),
      archiveComment: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveComment)),
      archiveDiscussion: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      archiveEvent: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveEvent)),
      unarchiveComment: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveComment)),
      unarchiveDiscussion: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveDiscussion)),
      unarchiveEvent: and(isAuthenticated, or(isChannelOwner, canArchiveAndUnarchiveEvent)),
      
      subscribeToDiscussionChannel: and(isAuthenticated, allow),
      unsubscribeFromDiscussionChannel: and(isAuthenticated, allow),
      subscribeToEvent: and(isAuthenticated, allow),
      unsubscribeFromEvent: and(isAuthenticated, allow),
      subscribeToComment: and(isAuthenticated, allow),
      unsubscribeFromComment: and(isAuthenticated, allow),
      subscribeToIssue: and(isAuthenticated, allow),
      unsubscribeFromIssue: and(isAuthenticated, allow),
      sendBugReport: allow, // Allow non-authenticated users to send bug reports

      deleteFilterGroups: allow,
      deleteFilterOptions: allow,
    },
  },{
    debug: true,
    allowExternalErrors: true
  });
  
  
  export default permissionList;
  