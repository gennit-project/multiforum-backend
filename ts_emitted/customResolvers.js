import pkg from "@neo4j/graphql-ogm";
import typeDefs from "./typeDefs.js";
import GraphQLJSON from "graphql-type-json";
import createDiscussionWithChannelConnections from "./customResolvers/mutations/createDiscussionWithChannelConnections.js";
import updateDiscussionWithChannelConnections from "./customResolvers/mutations/updateDiscussionWithChannelConnections.js";
import createEventWithChannelConnections from "./customResolvers/mutations/createEventWithChannelConnections.js";
import updateEventWithChannelConnections from "./customResolvers/mutations/updateEventWithChannelConnections.js";
import getSiteWideDiscussionList from "./customResolvers/queries/getSiteWideDiscussionList.js";
import getCommentSection from "./customResolvers/queries/getCommentSection.js";
import getEventComments from "./customResolvers/queries/getEventComments.js";
import getCommentReplies from "./customResolvers/queries/getCommentReplies.js";
import getDiscussionsInChannel from "./customResolvers/queries/getDiscussionsInChannel.js";
import getUserContributions from "./customResolvers/queries/getUserContributions.js";
import getChannelContributions from "./customResolvers/queries/getChannelContributions.js";
import addEmojiToComment from "./customResolvers/mutations/addEmojiToComment.js";
import removeEmojiFromComment from "./customResolvers/mutations/removeEmojiFromComment.js";
import addEmojiToDiscussionChannel from "./customResolvers/mutations/addEmojiToDiscussionChannel.js";
import removeEmojiFromDiscussionChannel from "./customResolvers/mutations/removeEmojiFromDiscussionChannel.js";
import upvoteComment from "./customResolvers/mutations/upvoteComment.js";
import undoUpvoteComment from "./customResolvers/mutations/undoUpvoteComment.js";
import upvoteDiscussionChannel from "./customResolvers/mutations/upvoteDiscussionChannel.js";
import undoUpvoteDiscussionChannel from "./customResolvers/mutations/undoUpvoteDiscussionChannel.js";
import createSignedStorageURL from "./customResolvers/mutations/createSignedStorageURL.js";
import safetyCheck from "./customResolvers/queries/safetyCheck.js";
import getCreateEmailAndUserResolver from "./customResolvers/mutations/createEmailAndUser.js";
import dropDataForCypressTestsResolver from "./customResolvers/mutations/dropDataForCypressTests.js";
import seedDataForCypressTestsResolver from "./customResolvers/mutations/seedDataForCypressTests.js";
import inviteForumOwner from './customResolvers/mutations/inviteForumOwner.js';
import removeForumOwner from './customResolvers/mutations/removeForumOwner.js';
import acceptForumOwnerInvite from './customResolvers/mutations/acceptForumOwnerInvite.js';
import becomeForumAdmin from './customResolvers/mutations/becomeForumAdmin.js';
import inviteForumMod from './customResolvers/mutations/inviteForumMod.js';
import removeForumMod from './customResolvers/mutations/removeForumMod.js';
import acceptForumModInvite from './customResolvers/mutations/acceptForumModInvite.js';
import cancelInviteForumMod from './customResolvers/mutations/cancelInviteForumMod.js';
import cancelInviteOwner from './customResolvers/mutations/cancelInviteForumOwner.js';
import getSortedChannels from './customResolvers/queries/getSortedChannels.js';
import reportComment from './customResolvers/mutations/reportComment.js';
import reportDiscussion from './customResolvers/mutations/reportDiscussion.js';
import reportEvent from './customResolvers/mutations/reportEvent.js';
import archiveComment from './customResolvers/mutations/archiveComment.js';
import unarchiveComment from './customResolvers/mutations/unarchiveComment.js';
import archiveDiscussion from './customResolvers/mutations/archiveDiscussion.js';
import unarchiveDiscussion from './customResolvers/mutations/unarchiveDiscussion.js';
import archiveEvent from './customResolvers/mutations/archiveEvent.js';
import unarchiveEvent from './customResolvers/mutations/unarchiveEvent.js';
import suspendUser from './customResolvers/mutations/suspendUser.js';
import suspendMod from './customResolvers/mutations/suspendMod.js';
import unsuspendUser from './customResolvers/mutations/unsuspendUser.js';
import unsuspendMod from './customResolvers/mutations/unsuspendMod.js';
import isOriginalPosterSuspended from './customResolvers/queries/isOriginalPosterSuspended.js';
import subscribeToComment from './customResolvers/mutations/subscribeToComment.js';
import unsubscribeFromComment from './customResolvers/mutations/unsubscribeFromComment.js';
import subscribeToDiscussionChannel from './customResolvers/mutations/subscribeToDiscussionChannel.js';
import unsubscribeFromDiscussionChannel from './customResolvers/mutations/unsubscribeFromDiscussionChannel.js';
import subscribeToEvent from './customResolvers/mutations/subscribeToEvent.js';
import unsubscribeFromEvent from './customResolvers/mutations/unsubscribeFromEvent.js';
import subscribeToIssue from './customResolvers/mutations/subscribeToIssue.js';
import unsubscribeFromIssue from './customResolvers/mutations/unsubscribeFromIssue.js';
import sendBugReport from './customResolvers/mutations/sendBugReport.js';
import refreshPlugins from './customResolvers/mutations/refreshPlugins.js';
import installPluginVersion from './customResolvers/mutations/installPluginVersion.js';
import triggerDownloadableFilePluginRuns from './customResolvers/mutations/triggerDownloadableFilePluginRuns.js';
import enableServerPlugin from './customResolvers/mutations/enableServerPlugin.js';
import setServerPluginSecret from './customResolvers/mutations/setServerPluginSecret.js';
import validateServerPluginSecret from './customResolvers/mutations/validateServerPluginSecret.js';
import getServerPluginSecrets from './customResolvers/queries/getServerPluginSecrets.js';
import getInstalledPlugins from './customResolvers/queries/getInstalledPlugins.js';
import getPluginRunsForDownloadableFile from './customResolvers/queries/getPluginRunsForDownloadableFile.js';
import userCollections from './customResolvers/fields/userCollections.js';
const { OGM } = pkg;
export default function (driver) {
    const ogm = new OGM({
        typeDefs,
        driver,
    });
    const Discussion = ogm.model("Discussion");
    const DiscussionChannel = ogm.model("DiscussionChannel");
    const Event = ogm.model("Event");
    const EventChannel = ogm.model("EventChannel");
    const Comment = ogm.model("Comment");
    const User = ogm.model("User");
    const Email = ogm.model("Email");
    const Channel = ogm.model("Channel");
    const Tag = ogm.model("Tag");
    const Issue = ogm.model("Issue");
    const ChannelRole = ogm.model("ChannelRole");
    const ModChannelRole = ogm.model("ModChannelRole");
    const ServerRole = ogm.model("ServerRole");
    const ModServerRole = ogm.model("ModServerRole");
    const ServerConfig = ogm.model("ServerConfig");
    const Suspension = ogm.model("Suspension");
    const Plugin = ogm.model("Plugin");
    const PluginVersion = ogm.model("PluginVersion");
    const PluginRun = ogm.model("PluginRun");
    const DownloadableFile = ogm.model("DownloadableFile");
    const ServerSecret = ogm.model("ServerSecret");
    const resolvers = {
        JSON: GraphQLJSON,
        CommentAuthor: {
            __resolveType(obj, context, info) {
                if (obj.username) {
                    return "User";
                }
                // Both user and mod profiles have this field so the order matters.
                if (obj.displayName) {
                    return "ModerationProfile";
                }
                return "User";
            },
        },
        User: {
            Collections: userCollections({ ogm }),
        },
        Query: {
            getSiteWideDiscussionList: getSiteWideDiscussionList({
                Discussion,
                driver,
            }),
            getDiscussionsInChannel: getDiscussionsInChannel({
                driver,
                DiscussionChannel,
            }),
            getCommentSection: getCommentSection({
                driver,
                DiscussionChannel,
                Comment,
            }),
            getEventComments: getEventComments({
                driver,
                Event,
                Comment,
            }),
            getCommentReplies: getCommentReplies({
                driver,
                Comment,
            }),
            getSortedChannels: getSortedChannels({
                driver,
            }),
            getUserContributions: getUserContributions({
                User,
                driver,
            }),
            getChannelContributions: getChannelContributions({
                Channel,
                driver,
            }),
            isOriginalPosterSuspended: isOriginalPosterSuspended({
                Issue,
                Discussion,
                Event,
                Comment,
                Channel
            }),
            safetyCheck: safetyCheck,
            getServerPluginSecrets: getServerPluginSecrets({
                ServerSecret
            }),
            getInstalledPlugins: getInstalledPlugins({
                ServerConfig
            }),
            getPluginRunsForDownloadableFile: getPluginRunsForDownloadableFile({
                PluginRun
            })
        },
        Mutation: {
            createDiscussionWithChannelConnections: createDiscussionWithChannelConnections({
                Discussion,
                driver,
            }),
            updateDiscussionWithChannelConnections: updateDiscussionWithChannelConnections({
                Discussion,
                driver,
            }),
            createEventWithChannelConnections: createEventWithChannelConnections({
                Event,
                driver,
            }),
            updateEventWithChannelConnections: updateEventWithChannelConnections({
                Event,
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
                Comment
            }),
            reportDiscussion: reportDiscussion({
                Issue,
                Discussion
            }),
            reportEvent: reportEvent({
                Issue,
                Event
            }),
            suspendUser: suspendUser({
                Issue,
                Channel,
                Comment,
                Event,
                Discussion
            }),
            unsuspendUser: unsuspendUser({
                Issue,
                Channel,
                Comment,
                Event,
                Discussion
            }),
            suspendMod: unsuspendMod({
                Issue,
                Channel,
                Comment,
                Event,
                Discussion
            }),
            unsuspendMod: suspendMod({
                Issue,
                Channel,
                Comment,
                Event,
                Discussion
            }),
            archiveComment: archiveComment({
                Issue,
                Comment,
            }),
            archiveDiscussion: archiveDiscussion({
                Issue,
                Discussion,
                DiscussionChannel
            }),
            archiveEvent: archiveEvent({
                Issue,
                Event,
                EventChannel
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
            enableServerPlugin: enableServerPlugin({
                Plugin,
                PluginVersion,
                ServerConfig,
                ServerSecret
            }),
            setServerPluginSecret: setServerPluginSecret({
                ServerSecret
            }),
            validateServerPluginSecret: validateServerPluginSecret({
                ServerSecret
            }),
        },
    };
    return {
        resolvers,
        ogm,
    };
}
