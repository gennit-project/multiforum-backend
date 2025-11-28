import { rule } from "graphql-shield";
import { isAuthenticatedAndVerified, isAuthenticated } from "./permission/userDataHelperFunctions.js";
import { hasServerPermission } from "./permission/hasServerPermission.js";
import { hasServerModPermission } from "./permission/hasServerModPermission.js";
import {
  isChannelOwner,
  isAccountOwner,
  isDiscussionOwner,
  isDiscussionChannelOwner,
  isEventOwner,
  isCommentAuthor,
  isCollectionOwner,
  isImageUploader,
} from "./permission/isOwner.js";
import {
  hasChannelPermission,
} from "./permission/hasChannelPermission.js";
import { checkChannelPermissions } from "./permission/hasChannelPermission.js";
import { checkChannelModPermissions, ModChannelPermission } from "./permission/hasChannelModPermission.js";
import { canArchiveAndUnarchiveDiscussion } from "./permission/canArchiveAndUnarchiveDiscussion.js";
import { canArchiveAndUnarchiveEvent } from "./permission/canArchiveAndUnarchiveEvent.js";
import { canArchiveAndUnarchiveComment } from "./permission/canArchiveAndUnarchiveComment.js";
import { canReport } from "./permission/canReport.js";
import { canSuspendAndUnsuspendUser } from "./permission/canSuspendAndUnsuspendUser.js";
import { canBecomeForumAdmin } from "./permission/canBecomeForumAdmin.js";
import {
  CommentCreateInput,
  DiscussionCreateInput,
  EventCreateInput,
  EventUpdateInput,
} from "../src/generated/graphql.js";
import {
  createDiscussionInputIsValid,
  updateDiscussionInputIsValid,
} from "./validation/discussionIsValid.js";
import {
  createCommentInputIsValid,
  updateCommentInputIsValid,
} from "./validation/commentIsValid.js";
import {
  createEventInputIsValid,
  updateEventInputIsValid,
} from "./validation/eventIsValid.js";
import {
  createChannelInputIsValid,
  updateChannelInputIsValid,
} from "./validation/channelIsValid.js";
import {
  createDownloadableFileInputIsValid,
  updateDownloadableFileInputIsValid,
} from "./validation/downloadableFileIsValid.js";
import { setUserDataOnContext } from "./permission/userDataHelperFunctions.js";

const canCreateChannel = rule({ cache: "contextual" })(
  async (parent: any, args: any, ctx: any, info: any) => {
    const hasPermissionToCreateChannels = hasServerPermission(
      "canCreateChannel",
      ctx
    );

    if (hasPermissionToCreateChannels instanceof Error) {
      return hasPermissionToCreateChannels;
    }

    return true;
  }
);

export type CreateDiscussionItem = {
  discussionCreateInput: DiscussionCreateInput;
  channelConnections: string[];
};

export type CanCreateDiscussionArgs = {
  input: CreateDiscussionItem[];
};

export type CanUpdateDiscussionArgs = {
  discussionUpdateInput: DiscussionCreateInput;
  channelConnections: string[];
};

export const canCreateDiscussion = rule({ cache: "contextual" })(
  async (parent: any, args: CanCreateDiscussionArgs, ctx: any, info: any) => {
    const inputItems = args.input;
    for (let i = 0; i < inputItems.length; i++) {
      const item = inputItems[i];
      const { channelConnections } = item;

      const channelPermissions = await checkChannelPermissions({
        channelConnections,
        context: ctx,
        permissionCheck: "canCreateDiscussion",
      });

      if (channelPermissions instanceof Error) {
        return channelPermissions;
      }
    }
    return true;
  }
);

export type SingleEventInput = {
  eventCreateInput: EventCreateInput;
  channelConnections: string[];
}

export type CanCreateEventArgs = {
  input: SingleEventInput[];
};

export const canCreateEvent = rule({ cache: "contextual" })(
  async (parent: any, args: CanCreateEventArgs, ctx: any, info: any) => {
    const dedupedChannelConnections = args.input.map((item) => item.channelConnections);
    const channelConnections = [...new Set(dedupedChannelConnections)];
    const flattenedChannelConnections = channelConnections.flat();
    
    return checkChannelPermissions({
      channelConnections: flattenedChannelConnections,
      context: ctx,
      permissionCheck: "canCreateEvent",
    });
  }
);

type CanCreateCommentArgs = {
  input: CommentCreateInput[];
};

export const canCreateComment = rule({ cache: "contextual" })(
  async (parent: any, args: CanCreateCommentArgs, ctx: any, info: any) => {
    const { input } = args;
    const firstItemInInput = input[0];

    if (!firstItemInInput) {
      throw new Error("No comment create input found.");
    }

    const { 
      DiscussionChannel, 
      Event,
      GivesFeedbackOnEvent,
      GivesFeedbackOnDiscussion,
      GivesFeedbackOnComment,
      Channel,
    } = firstItemInInput;

    // Throw an error if no Channel is provided; all comments must be in the context of a channel.
    if (!Channel || !Channel.connect?.where?.node?.uniqueName) {
      throw new Error("Comment must be connected to a Channel.");
    }

    let channelName = '';
    
    // Determine if this is a feedback comment
    const isFeedbackComment = !!(GivesFeedbackOnEvent || GivesFeedbackOnDiscussion || GivesFeedbackOnComment);

    if (DiscussionChannel){
      const discussionChannelId = DiscussionChannel.connect?.where?.node?.id;

      if (!discussionChannelId) {
        throw new Error("No discussion channel ID found.");
      }
  
      // Look up the channelUniqueName from the discussion channel ID.
      const discussionChannelModel = ctx.ogm.model("DiscussionChannel");
      const discussionChannel = await discussionChannelModel.find({
        where: { id: discussionChannelId },
        selectionSet: `{ channelUniqueName }`,
      });

      if (!discussionChannel || !discussionChannel[0]) {
        throw new Error("No discussion channel found.");
      }
  
      channelName = discussionChannel[0]?.channelUniqueName;
    }

    if (Event) {
      const eventId = Event.connect?.where?.node?.id;

      if (!eventId) {
        throw new Error("No event ID found.");
      }  

      // Validate that the user has permission to comment on the event.
      // The channel that they are posting in needs to match one of the
      // channels that the event is connected to.
      const eventChannelModel = ctx.ogm.model("EventChannel");
      const event = await eventChannelModel.find({
        where: { 
          eventId,
          channelUniqueName: Channel?.connect?.where?.node?.uniqueName
        },
        selectionSet: `{ id }`,
      });

      if (!event || !event[0]) {
        throw new Error("Could not find the event submission in the given channel.");
      }

      channelName = Channel?.connect?.where?.node?.uniqueName
    }

    if (GivesFeedbackOnEvent) {
      const eventId = GivesFeedbackOnEvent.connect?.where?.node?.id;

      if (!eventId) {
        throw new Error("No event ID found.");
      }

      // Validate that the user has permission to comment on the event.
      // The channel that they are posting in needs to match one of the
      // channels that the event is connected to.
      const eventChannelModel = ctx.ogm.model("EventChannel");
      const event = await eventChannelModel.find({
        where: { 
          eventId,
          channelUniqueName: Channel?.connect?.where?.node?.uniqueName
        },
        selectionSet: `{ id }`,
      });

      if (!event || !event[0]) {
        throw new Error("Could not find the event submission in the given channel.");
      }

      channelName = Channel?.connect?.where?.node?.uniqueName
    }

    if (GivesFeedbackOnDiscussion) {
      // GivesFeedbackOnDiscussion is of type Discussion which doesn't directly have
      // the channel on it, so we use the DiscussionChannel to get the channel name.
      const discussionChannelId = DiscussionChannel?.connect?.where?.node?.id;

      if (!discussionChannelId) {
        throw new Error("No discussion channel ID found.");
      }
  
      // Look up the channelUniqueName from the discussion channel ID.
      const discussionChannelModel = ctx.ogm.model("DiscussionChannel");
      const discussionChannel = await discussionChannelModel.find({
        where: { id: discussionChannelId },
        selectionSet: `{ channelUniqueName }`,
      });
  
      if (!discussionChannel || !discussionChannel[0]) {
        throw new Error("No discussion channel found.");
      }
  
      channelName = discussionChannel[0]?.channelUniqueName;
    }

    if (GivesFeedbackOnComment) {
      const commentId = GivesFeedbackOnComment?.connect?.where?.node?.id;

      if (!commentId) {
        throw new Error("No comment ID found.");
      }
  
      channelName = Channel?.connect?.where?.node?.uniqueName;
    }
    
    if (!channelName) {
      throw new Error("No channel name found.");
    }

    // Different permission checking based on whether it's a feedback comment
    if (isFeedbackComment) {
      // For feedback comments, check mod permissions with canGiveFeedback
      return checkChannelModPermissions({
        channelConnections: [channelName],
        context: ctx,
        permissionCheck: ModChannelPermission.canGiveFeedback
      });
    } else {
      // For regular comments, check regular permissions
      return checkChannelPermissions({
        channelConnections: [channelName],
        context: ctx,
        permissionCheck: "canCreateComment",
      });
    }
  }
);

const isAdmin = rule({ cache: "contextual" })(
  async (parent: any, args: any, ctx: any, info: any) => {
    // set user on context
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: true,
    });

    if (!ctx.user) {
      return false;
    }
    let isAdmin = false;
    const serverRoles = ctx.user?.data?.ServerRoles || [];
    const email = ctx.user?.email;

    if (email === process.env.CYPRESS_ADMIN_TEST_EMAIL) {
      // This email is used only for cypress tests. We need
      // to whitelist it as an admin so that we don't have the catch-22
      // of needing an admin to create an admin.
      isAdmin = true;
    }
    for (const role of serverRoles) {
      if (role.showAdminTag) {
        isAdmin = true;
      }
    }
    return isAdmin;
  }
);

const canUploadFile = rule({ cache: "contextual" })(
  async (parent: any, args: any, ctx: any, info: any) => {
    const permissionResult = await hasServerPermission(
      "canUploadFile",
      ctx
    );

    if (!permissionResult) {
      return false;
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);

type CanUpvoteCommentArgs = {
  commentId: string;
  username: string;
};

const canUpvoteComment = rule({ cache: "contextual" })(
  async (parent: any, args: CanUpvoteCommentArgs, ctx: any, info: any) => {
    const CommentModel = ctx.ogm.model("Comment");

    const { commentId, username } = args;

    if (!commentId || !username) {
      throw new Error("All arguments (commentId, username) are required");
    }

    const commentData = await CommentModel.find({
      where: { id: commentId },
      selectionSet: `{ 
        id
        DiscussionChannel {
          channelUniqueName
        }
        Channel {
          uniqueName
        }
      }`,
    });

    if (!commentData || !commentData[0]) {
      throw new Error("No comment found.");
    }

    // Try to get channel name either from DiscussionChannel or directly from Channel
    let channelThatCommentIsIn = commentData[0]?.DiscussionChannel?.channelUniqueName;
    
    // If not found in DiscussionChannel, try the direct Channel relationship
    if (!channelThatCommentIsIn) {
      channelThatCommentIsIn = commentData[0]?.Channel?.uniqueName;
    }

    if (!channelThatCommentIsIn) {
      throw new Error("No channel found. Comment must be associated with a channel.");
    }

    const permissionResult = await hasChannelPermission({
      permission: "canUpvoteComment",
      channelName: channelThatCommentIsIn,
      context: ctx,
    });

    if (!permissionResult) {
      throw new Error("The user does not have permission in this channel.");
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);

type CanUpvoteDiscussionChannelArgs = {
  discussionChannelId: string;
  username: string;
};

const canUpvoteDiscussion = rule({ cache: "contextual" })(
  async (
    parent: any,
    args: CanUpvoteDiscussionChannelArgs,
    ctx: any,
    info: any
  ) => {
    const DiscussionChannelModel = ctx.ogm.model("DiscussionChannel");

    // get channel name from discussion channel id
    const { discussionChannelId, username } = args;

    if (!discussionChannelId || !username) {
      throw new Error(
        "All arguments (discussionChannelId, username) are required"
      );
    }

    const discussionChannelData = await DiscussionChannelModel.find({
      where: { id: discussionChannelId },
      selectionSet: `{ 
        id
        channelUniqueName
      }`,
    });

    if (!discussionChannelData || !discussionChannelData[0]) {
      throw new Error("No discussion channel found.");
    }

    const channelName = discussionChannelData[0]?.channelUniqueName;

    if (!channelName) {
      throw new Error("No channel found.");
    }

    const permissionResult = await hasChannelPermission({
      permission: "canUpvoteDiscussion",
      channelName,
      context: ctx,
    });

    if (!permissionResult) {
      throw new Error("The user does not have permission in this channel.");
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);

const canGiveFeedback = rule({ cache: "contextual" })(
  async (parent: any, args: any, ctx: any, info: any) => {
    const permissionResult = await hasServerModPermission(
      "canGiveFeedback",
      ctx
    );

    if (!permissionResult) {
      return false;
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);

const canReportContent = rule({ cache: "contextual" })(
  async (parent: any, args: any, ctx: any, info: any) => {
    // Placeholder rule for now

    return true;
  }
);

const issueIsValid = rule({ cache: "contextual" })(
  async (parent: any, args: any, ctx: any, info: any) => {
    return true;
  }
);

const ruleList = {
  isChannelOwner,
  isDiscussionOwner,
  isDiscussionChannelOwner,
  isEventOwner,
  isCommentAuthor,
  isAuthenticatedAndVerified,
  isAuthenticated,
  issueIsValid,
  canCreateChannel,
  canCreateComment,
  canCreateDiscussion,
  canCreateEvent,
  createChannelInputIsValid,
  createCommentInputIsValid,
  updateChannelInputIsValid,
  updateCommentInputIsValid,
  createDiscussionInputIsValid,
  updateDiscussionInputIsValid,
  createEventInputIsValid,
  updateEventInputIsValid,
  createDownloadableFileInputIsValid,
  updateDownloadableFileInputIsValid,
  hasChannelPermission,
  isAdmin,
  isAccountOwner,
  canUploadFile,
  canUpvoteComment,
  canUpvoteDiscussion,
  canGiveFeedback,
  canReportContent,
  canArchiveAndUnarchiveDiscussion,
  canArchiveAndUnarchiveEvent,
  canArchiveAndUnarchiveComment,
  canReport,
  canSuspendAndUnsuspendUser,
  canBecomeForumAdmin,
  isCollectionOwner,
  isImageUploader,
};

export default ruleList;
