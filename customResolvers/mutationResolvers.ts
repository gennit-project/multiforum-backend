// Mutation resolvers. Extracted from customResolvers.ts; receives the shared
// ResolverDeps and wires each custom mutation to its models/driver. The wiring
// is byte-for-byte the original Mutation map, just destructured from `deps`.
import type { ResolverDeps } from "./resolverDeps.js";
import createDiscussionWithChannelConnections from "./mutations/createDiscussionWithChannelConnections.js";
import updateDiscussionWithChannelConnections from "./mutations/updateDiscussionWithChannelConnections.js";
import createEventWithChannelConnections from "./mutations/createEventWithChannelConnections.js";
import createEventSeriesWithChannelConnections from "./mutations/createEventSeriesWithChannelConnections.js";
import updateEventWithChannelConnections from "./mutations/updateEventWithChannelConnections.js";
import updateEventInSeries from "./mutations/updateEventInSeries.js";
import deleteEventInSeries from "./mutations/deleteEventInSeries.js";
import addEmojiToComment from "./mutations/addEmojiToComment.js";
import removeEmojiFromComment from "./mutations/removeEmojiFromComment.js";
import addEmojiToDiscussionChannel from "./mutations/addEmojiToDiscussionChannel.js";
import removeEmojiFromDiscussionChannel from "./mutations/removeEmojiFromDiscussionChannel.js";
import upvoteComment from "./mutations/upvoteComment.js";
import undoUpvoteComment from "./mutations/undoUpvoteComment.js";
import upvoteDiscussionChannel from "./mutations/upvoteDiscussionChannel.js";
import undoUpvoteDiscussionChannel from "./mutations/undoUpvoteDiscussionChannel.js";
import createSignedStorageURL from "./mutations/createSignedStorageURL.js";
import getCreateEmailAndUserResolver from "./mutations/createEmailAndUser.js";
import dropDataForCypressTestsResolver from "./mutations/dropDataForCypressTests.js";
import seedDataForCypressTestsResolver from "./mutations/seedDataForCypressTests.js";
import inviteForumOwner from "./mutations/inviteForumOwner.js";
import removeForumOwner from "./mutations/removeForumOwner.js";
import acceptForumOwnerInvite from "./mutations/acceptForumOwnerInvite.js";
import becomeForumAdmin from "./mutations/becomeForumAdmin.js";
import inviteForumMod from "./mutations/inviteForumMod.js";
import removeForumMod from "./mutations/removeForumMod.js";
import acceptForumModInvite from "./mutations/acceptForumModInvite.js";
import cancelInviteForumMod from "./mutations/cancelInviteForumMod.js";
import cancelInviteOwner from "./mutations/cancelInviteForumOwner.js";
import inviteServerAdmin from "./mutations/inviteServerAdmin.js";
import acceptServerAdminInvite from "./mutations/acceptServerAdminInvite.js";
import cancelInviteServerAdmin from "./mutations/cancelInviteServerAdmin.js";
import inviteServerMod from "./mutations/inviteServerMod.js";
import acceptServerModInvite from "./mutations/acceptServerModInvite.js";
import cancelInviteServerMod from "./mutations/cancelInviteServerMod.js";
import reportComment from "./mutations/reportComment.js";
import reportDiscussion from "./mutations/reportDiscussion.js";
import reportEvent from "./mutations/reportEvent.js";
import reportWikiEdit from "./mutations/reportWikiEdit.js";
import redactTextVersionRevision from "./mutations/redactTextVersionRevision.js";
import reportChannel from "./mutations/reportChannel.js";
import reportImage from "./mutations/reportImage.js";
import reportProfilePicture from "./mutations/reportProfilePicture.js";
import reportChannelImage from "./mutations/reportChannelImage.js";
import lockChannel from "./mutations/lockChannel.js";
import unlockChannel from "./mutations/unlockChannel.js";
import archiveComment from "./mutations/archiveComment.js";
import unarchiveComment from "./mutations/unarchiveComment.js";
import archiveDiscussion from "./mutations/archiveDiscussion.js";
import unarchiveDiscussion from "./mutations/unarchiveDiscussion.js";
import archiveEvent from "./mutations/archiveEvent.js";
import unarchiveEvent from "./mutations/unarchiveEvent.js";
import archiveImage from "./mutations/archiveImage.js";
import unarchiveImage from "./mutations/unarchiveImage.js";
import permanentlyRemoveImage from "./mutations/permanentlyRemoveImage.js";
import permanentlyDeleteImage from "./mutations/permanentlyDeleteImage.js";
import permanentlyDeleteDownloadableFile from "./mutations/permanentlyDeleteDownloadableFile.js";
import permanentlyDeleteProfileImage from "./mutations/permanentlyDeleteProfileImage.js";
import permanentlyDeleteChannelBanner from "./mutations/permanentlyDeleteChannelBanner.js";
import createIssue from "./mutations/createIssue.js";
import suspendUser from "./mutations/suspendUser.js";
import suspendMod from "./mutations/suspendMod.js";
import unsuspendUser from "./mutations/unsuspendUser.js";
import unsuspendMod from "./mutations/unsuspendMod.js";
import lockIssue from "./mutations/lockIssue.js";
import unlockIssue from "./mutations/unlockIssue.js";
import subscribeToComment from "./mutations/subscribeToComment.js";
import unsubscribeFromComment from "./mutations/unsubscribeFromComment.js";
import subscribeToDiscussionChannel from "./mutations/subscribeToDiscussionChannel.js";
import unsubscribeFromDiscussionChannel from "./mutations/unsubscribeFromDiscussionChannel.js";
import subscribeToEvent from "./mutations/subscribeToEvent.js";
import unsubscribeFromEvent from "./mutations/unsubscribeFromEvent.js";
import subscribeToEventUpdates from "./mutations/subscribeToEventUpdates.js";
import unsubscribeFromEventUpdates from "./mutations/unsubscribeFromEventUpdates.js";
import subscribeToIssue from "./mutations/subscribeToIssue.js";
import unsubscribeFromIssue from "./mutations/unsubscribeFromIssue.js";
import sendBugReport from "./mutations/sendBugReport.js";
import refreshPlugins from "./mutations/refreshPlugins.js";
import installPluginVersion from "./mutations/installPluginVersion.js";
import triggerDownloadableFilePluginRuns from "./mutations/triggerDownloadableFilePluginRuns.js";
import trackDownload from "./mutations/trackDownload.js";
import updateDownloadableFileSupportSettings from "./mutations/updateDownloadableFileSupportSettings.js";
import createDownloadableFilesWithUploadMetadata from "./mutations/createDownloadableFilesWithUploadMetadata.js";
import enableServerPlugin from "./mutations/enableServerPlugin.js";
import setServerPluginSecret from "./mutations/setServerPluginSecret.js";
import updatePluginPipelines from "./mutations/updatePluginPipelines.js";
import updateChannelPluginPipelines from "./mutations/updateChannelPluginPipelines.js";
import createImageWithUploader from "./mutations/createImageWithUploader.js";
import createImagesWithUploader from "./mutations/createImagesWithUploader.js";
import createAlbumsWithOwner from "./mutations/createAlbumsWithOwner.js";
import createCollectionsWithOwner from "./mutations/createCollectionsWithOwner.js";
import updateDownloadLabels from "./mutations/updateDownloadLabels.js";
import createScratchpadEntry from "./mutations/createScratchpadEntry.js";
import undoSuperUpvote from "./mutations/undoSuperUpvote.js";
import updateScratchpadEntryVisibility from "./mutations/updateScratchpadEntryVisibility.js";
import deleteScratchpadEntry from "./mutations/deleteScratchpadEntry.js";
import {
  addToCollection,
  removeFromCollection,
  reorderCollectionItem,
} from "./mutations/collectionOrdering.js";

export default function buildMutationResolvers(deps: ResolverDeps) {
  const {
    driver,
    Discussion,
    DiscussionChannel,
    Event,
    EventChannel,
    EventSeries,
    Comment,
    User,
    Email,
    Channel,
    Tag,
    Issue,
    ChannelRole,
    ModChannelRole,
    ServerRole,
    ModServerRole,
    ServerConfig,
    Plugin,
    PluginVersion,
    PluginRun,
    DownloadableFile,
    ServerSecret,
    Image,
    Album,
    Collection,
    WikiPage,
    TextVersion,
    FilterOption,
    ModerationAction,
    LabelChangeHistory,
    ScratchpadEntry,
  } = deps;

  return {
    createDiscussionWithChannelConnections:
      createDiscussionWithChannelConnections({
        Discussion,
        driver,
        // Plugin pipeline support
        Channel,
        DownloadableFile,
        PluginRun,
        ServerConfig,
        ServerSecret,
      }),
    createIssue: createIssue({
      Issue,
      driver
    }),
    updateDiscussionWithChannelConnections:
      updateDiscussionWithChannelConnections({
        Discussion,
        driver,
      }),
    createEventWithChannelConnections: createEventWithChannelConnections({
      Event,
      driver,
    }),
    createEventSeriesWithChannelConnections: createEventSeriesWithChannelConnections({
      EventSeries,
      Event,
      Tag,
      driver,
    }),
    updateEventWithChannelConnections: updateEventWithChannelConnections({
      Event,
      driver,
    }),
    updateEventInSeries: updateEventInSeries({
      Event,
      EventSeries,
      driver,
    }),
    deleteEventInSeries: deleteEventInSeries({
      Event,
      EventSeries,
      driver,
    }),
    addEmojiToComment: addEmojiToComment({
      Comment,
    }),
    removeEmojiFromComment: removeEmojiFromComment({
      Comment,
    }),
    addEmojiToDiscussionChannel: addEmojiToDiscussionChannel({
      DiscussionChannel,
    }),
    removeEmojiFromDiscussionChannel: removeEmojiFromDiscussionChannel({
      DiscussionChannel,
    }),
    upvoteComment: upvoteComment({
      Comment,
      User,
      driver,
    }),
    undoUpvoteComment: undoUpvoteComment({
      Comment,
      User,
      driver,
    }),
    upvoteDiscussionChannel: upvoteDiscussionChannel({
      DiscussionChannel,
      User,
      driver,
    }),
    undoUpvoteDiscussionChannel: undoUpvoteDiscussionChannel({
      DiscussionChannel,
      User,
      driver,
    }),
    createSignedStorageURL: createSignedStorageURL(),
    createEmailAndUser: getCreateEmailAndUserResolver({
      User,
      Email,
    }),
    inviteForumOwner: inviteForumOwner({
      Channel,
      User
    }),
    cancelInviteForumOwner: cancelInviteOwner({
      Channel
    }),
    removeForumOwner: removeForumOwner({
      Channel
    }),
    acceptForumOwnerInvite: acceptForumOwnerInvite({
      Channel,
    }),
    becomeForumAdmin: becomeForumAdmin({
      Channel,
    }),
    inviteForumMod: inviteForumMod({
      Channel,
      User
    }),
    cancelInviteForumMod: cancelInviteForumMod({
      Channel
    }),
    removeForumMod: removeForumMod({
      Channel,
      User
    }),
    acceptForumModInvite: acceptForumModInvite({
      Channel,
      User
    }),
    // Server admin/mod invite workflow
    inviteServerAdmin: inviteServerAdmin({
      ServerConfig,
      User
    }),
    cancelInviteServerAdmin: cancelInviteServerAdmin({
      ServerConfig
    }),
    acceptServerAdminInvite: acceptServerAdminInvite({
      ServerConfig
    }),
    inviteServerMod: inviteServerMod({
      ServerConfig,
      User
    }),
    cancelInviteServerMod: cancelInviteServerMod({
      ServerConfig
    }),
    acceptServerModInvite: acceptServerModInvite({
      ServerConfig,
      User
    }),
    dropDataForCypressTests: dropDataForCypressTestsResolver({ driver }),
    seedDataForCypressTests: seedDataForCypressTestsResolver({
      driver,
      Channel,
      Discussion,
      Event,
      Comment,
      User,
      Email,
      Tag,
      ChannelRole,
      ModChannelRole,
      ServerRole,
      ModServerRole,
      ServerConfig,
    }),
    reportComment: reportComment({
      Issue,
      Comment,
      driver
    }),
    reportDiscussion: reportDiscussion({
      Issue,
      Discussion,
      driver
    }),
    reportEvent: reportEvent({
      Issue,
      Event,
      driver
    }),
    reportWikiEdit: reportWikiEdit({
      Issue,
      WikiPage,
      TextVersion,
      driver
    }),
    deleteCommentRevision: redactTextVersionRevision({
      TextVersion,
      driver,
      revisionType: 'comment',
    }),
    deleteDiscussionBodyRevision: redactTextVersionRevision({
      TextVersion,
      driver,
      revisionType: 'discussion body',
    }),
    deleteWikiRevision: redactTextVersionRevision({
      TextVersion,
      driver,
      revisionType: 'wiki',
    }),
    reportChannel: reportChannel({
      Issue,
      Channel,
      driver
    }),
    reportImage: reportImage({
      Issue,
      Image,
      driver
    }),
    reportProfilePicture: reportProfilePicture({
      Issue,
      User,
      driver
    }),
    reportChannelImage: reportChannelImage({
      Issue,
      Channel,
      driver
    }),
    archiveImage: archiveImage({
      Issue,
      Image,
      driver
    }),
    unarchiveImage: unarchiveImage({
      Issue,
      Image
    }),
    permanentlyRemoveImage: permanentlyRemoveImage({
      Issue,
      Image,
      driver
    }),
    permanentlyDeleteImage: permanentlyDeleteImage({
      driver
    }),
    permanentlyDeleteDownloadableFile: permanentlyDeleteDownloadableFile({
      driver
    }),
    permanentlyDeleteProfileImage: permanentlyDeleteProfileImage({
      driver
    }),
    permanentlyDeleteChannelBanner: permanentlyDeleteChannelBanner({
      driver
    }),
    lockChannel: lockChannel({
      Issue,
      Channel,
      driver
    }),
    unlockChannel: unlockChannel({
      Issue,
      Channel,
      driver
    }),
    suspendUser: suspendUser({
      Issue,
      Channel,
      ServerConfig,
      Comment,
      Event,
      Discussion,
      User,
      WikiPage,
      TextVersion
    }),
    unsuspendUser: unsuspendUser({
      Issue,
      Channel,
      ServerConfig,
      Comment,
      Event,
      Discussion,
      User
    }),
    suspendMod: suspendMod({
      Issue,
      Channel,
      ServerConfig,
      Comment,
      Event,
      Discussion,
      User
    }),
    unsuspendMod: unsuspendMod({
      Issue,
      Channel,
      ServerConfig,
      Comment,
      Event,
      Discussion,
      User
    }),
    lockIssue: lockIssue({
      Issue
    }),
    unlockIssue: unlockIssue({
      Issue
    }),
    archiveComment: archiveComment({
      Issue,
      Comment,
      driver,
    }),
    archiveDiscussion: archiveDiscussion({
      Issue,
      Discussion,
      DiscussionChannel,
      driver,
    }),
    archiveEvent: archiveEvent({
      Issue,
      Event,
      EventChannel,
      driver,
    }),
    unarchiveComment: unarchiveComment({
      Issue,
      Comment,
    }),
    unarchiveDiscussion: unarchiveDiscussion({
      Issue,
      DiscussionChannel
    }),
    unarchiveEvent: unarchiveEvent({
      Issue,
      EventChannel
    }),
    subscribeToComment: subscribeToComment({
      Comment,
      driver
    }),
    unsubscribeFromComment: unsubscribeFromComment({
      Comment,
      driver
    }),
    subscribeToDiscussionChannel: subscribeToDiscussionChannel({
      DiscussionChannel,
      driver
    }),
    unsubscribeFromDiscussionChannel: unsubscribeFromDiscussionChannel({
      DiscussionChannel,
      driver
    }),
    subscribeToEvent: subscribeToEvent({
      Event,
      driver
    }),
    unsubscribeFromEvent: unsubscribeFromEvent({
      Event,
      driver
    }),
    subscribeToEventUpdates: subscribeToEventUpdates({
      Event,
      driver
    }),
    unsubscribeFromEventUpdates: unsubscribeFromEventUpdates({
      Event,
      driver
    }),
    subscribeToIssue: subscribeToIssue({
      Issue,
      driver
    }),
    unsubscribeFromIssue: unsubscribeFromIssue({
      Issue,
      driver
    }),
    sendBugReport: sendBugReport(),
    refreshPlugins: refreshPlugins({
      Plugin,
      PluginVersion,
      ServerConfig
    }),
    installPluginVersion: installPluginVersion({
      Plugin,
      PluginVersion,
      ServerConfig
    }),
    triggerDownloadableFilePluginRuns: triggerDownloadableFilePluginRuns({
      DownloadableFile,
      Plugin,
      PluginVersion,
      PluginRun,
      ServerConfig,
      ServerSecret
    }),
    trackDownload: trackDownload({
      driver
    }),
    updateDownloadableFileSupportSettings: updateDownloadableFileSupportSettings({
      driver
    }),
    createDownloadableFiles: createDownloadableFilesWithUploadMetadata({
      DownloadableFile,
      driver
    }),
    enableServerPlugin: enableServerPlugin({
      Plugin,
      PluginVersion,
      ServerConfig,
      ServerSecret
    }),
    setServerPluginSecret: setServerPluginSecret({
      ServerSecret
    }),
    updatePluginPipelines: updatePluginPipelines({
      ServerConfig
    }),
    updateChannelPluginPipelines: updateChannelPluginPipelines({
      Channel,
      ServerConfig,
      User
    }),
    createImageWithUploader: createImageWithUploader({
      Image,
      User,
      driver
    }),
    createImages: createImagesWithUploader({
      Image,
      User,
      driver
    }),
    createAlbums: createAlbumsWithOwner({
      Album,
      User
    }),
    createCollections: createCollectionsWithOwner({
      Collection,
      User
    }),
    addToCollection: addToCollection({
      driver
    }),
    removeFromCollection: removeFromCollection({
      driver
    }),
    reorderCollectionItem: reorderCollectionItem({
      driver
    }),
    updateDownloadLabels: updateDownloadLabels({
      Discussion,
      DiscussionChannel,
      FilterOption,
      ModerationAction,
      LabelChangeHistory,
    }),
    createScratchpadEntry: createScratchpadEntry({
      ScratchpadEntry,
      Comment,
      DiscussionChannel,
      User,
      driver,
    }),
    undoSuperUpvote: undoSuperUpvote({
      Comment,
      DiscussionChannel,
      ScratchpadEntry,
      driver,
    }),
    updateScratchpadEntryVisibility: updateScratchpadEntryVisibility({
      ScratchpadEntry,
    }),
    deleteScratchpadEntry: deleteScratchpadEntry({
      ScratchpadEntry,
    }),
  };
}
