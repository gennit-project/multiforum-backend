import { rule } from "graphql-shield";
import { ERROR_MESSAGES } from "../../rules/errorMessages.js";
import {
  ChannelWhere,
  Channel,
  Comment,
  Discussion,
  Event,
  DiscussionWhere,
  DiscussionChannelWhere,
  DiscussionUpdateInput,
  EventWhere,
  EventUpdateInput,
  CommentWhere,
  UserWhere,
  User,
  Collection,
  CollectionWhere,
} from "../../src/generated/graphql.js";
import { setUserDataOnContext } from "./userDataHelperFunctions.js";

type IsChannelOwnerInput = {
  where: ChannelWhere;
  channelUniqueName: string;
  issueId?: string;
  commentId?: string;
};

export const isChannelOwner = rule({ cache: "contextual" })(
  async (parent: any, args: IsChannelOwnerInput, ctx: any, info: any) => {

    // set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });
    let username = ctx.user.username;
    console.log("username: ", ctx.user);

    let ogm = ctx.ogm;
    const { where, channelUniqueName, issueId, commentId } = args;
    console.log('args: ', JSON.stringify(args));
    let uniqueName = '';

    if (where?.uniqueName) {
      // The channel name can be passed in the where object.
      uniqueName = where.uniqueName;
    }

    if (channelUniqueName) {
      // It can also be passed as a separate argument.
      uniqueName = channelUniqueName;
    }

    // If no channel name is provided but we have a commentId, look it up
    if (!uniqueName && commentId) {
      const Comment = ogm.model("Comment");
      const comment = await Comment.find({
        where: { id: commentId },
        selectionSet: `{ 
          DiscussionChannel {
            channelUniqueName
          }
          Channel {
            uniqueName
          }
        }`,
      });

      if (!comment || !comment[0]) {
        throw new Error(ERROR_MESSAGES.channel.notFound);
      }

      // Try to get channel name from either DiscussionChannel or Channel
      uniqueName = comment[0]?.DiscussionChannel?.channelUniqueName || 
                  comment[0]?.Channel?.uniqueName;

      if (!uniqueName) {
        throw new Error(ERROR_MESSAGES.channel.notFound);
      }
    }

    // If no channel name is provided but we have an issueId, look it up
    if (!uniqueName && issueId) {
      const Issue = ogm.model("Issue");
      const issue = await Issue.find({
        where: { id: issueId },
        selectionSet: `{ 
          channelUniqueName
        }`,
      });
      console.log('issue', JSON.stringify(issue));

      if (!issue || !issue[0]) {
        throw new Error(ERROR_MESSAGES.channel.notFound);
      }

      uniqueName = issue[0].channelUniqueName;
    }

    if (!uniqueName) {
      throw new Error(ERROR_MESSAGES.channel.notFound);
    }

    const ChannelModel = ogm.model("Channel");

    // Get the list of channel owners by using the OGM on the
    // Channel object.
    const channel: Channel[] = await ChannelModel.find({
      where: { uniqueName },
      selectionSet: `{ 
            Admins { 
                username
            } 
      }`,
    });

    if (!channel) {
      throw new Error(ERROR_MESSAGES.channel.notFound);
    }

    if (channel.length === 0) {
      throw new Error(ERROR_MESSAGES.channel.notFound);
    }

    // Get the list of channel owners.
    const channelOwners = channel[0].Admins.map((admin) => admin.username);

    // Check if the user is in the list of channel owners.
    if (!channelOwners.includes(username)) {
      return false;  // Permission check - return false to allow OR to work
    }

    return true;
  }
);

type IsDiscussionOwnerInput = {
  where: DiscussionWhere;
  discussionUpdateInput: DiscussionUpdateInput;
  channelConnections: string[];
  channelDisconnections: string[];
};

export const isDiscussionOwner = rule({ cache: "contextual" })(
  async (parent: any, args: IsDiscussionOwnerInput, ctx: any, info: any) => {
    let discussionId;

    const { where } = args;
    if (where) {
      discussionId = where.id;
    }

    // set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    let username = ctx.user.username;
    let ogm = ctx.ogm;

    if (!discussionId) {
      throw new Error(ERROR_MESSAGES.discussion.noId);
    }
    const DiscussionModel = ogm.model("Discussion");

    // Get the discussion owner by using the OGM on the
    // Discussion model.
    const discussions: Discussion[] = await DiscussionModel.find({
      where: { id: discussionId },
      selectionSet: `{ 
            Author { 
                username
            } 
      }`,
    });

    if (!discussions || discussions.length === 0) {
      throw new Error(ERROR_MESSAGES.channel.notFound);
    }
    const discussion = discussions[0];

    // Get the discussion author.
    const discussionOwner = discussion?.Author?.username;

    if (!discussionOwner) {
      throw new Error(ERROR_MESSAGES.discussion.noAuthor);
    }

    // Check if the user is the discussion owner
    if (discussionOwner !== username) {
      return false;  // Permission check - return false to allow OR to work
    }
    return true;
  }
);

type IsEventOwnerInput = {
  where: EventWhere;
  eventUpdateInput: EventUpdateInput;
  channelConnections: string[];
  channelDisconnections: string[];
};

export const isEventOwner = rule({ cache: "contextual" })(
  async (parent: any, args: IsEventOwnerInput, ctx: any, info: any) => {

    let eventId;

    const { where } = args;
    if (where) {
      eventId = where.id;
    }

    // set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    let username = ctx.user.username;
    let ogm = ctx.ogm;

    if (!eventId) {
      throw new Error(ERROR_MESSAGES.event.noId);
    }
    const EventModel = ogm.model("Event");

    // Get the event owner by using the OGM on the
    // Event model.
    const events: Event[] = await EventModel.find({
      where: { id: eventId },
      selectionSet: `{ 
            Poster { 
                username
            } 
      }`,
    });

    if (!events || events.length === 0) {
      throw new Error(ERROR_MESSAGES.event.notFound);
    }
    const event = events[0];

    // Get the event author.
    const eventOwner = event?.Poster?.username;

    if (!eventOwner) {
      throw new Error(ERROR_MESSAGES.event.noOwner);
    }

    // Check if the user is in the list of channel owners.
    if (eventOwner !== username) {
      throw new Error(ERROR_MESSAGES.event.notOwner);
    }
    return true;
  }
);

type IsCommentAuthorInput = {
  where: CommentWhere;
  update: CommentWhere;
};

export const isCommentAuthor = rule({ cache: "contextual" })(
  async (parent: any, args: IsCommentAuthorInput, ctx: any, info: any) => {
    console.log("isCommentAuthor rule");
    const { where } = args;
    const commentId  = where.id

    // set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    let username = ctx.user.username;
    let modName =  ctx.user.data?.ModerationProfile?.displayName || null;
    console.log("username: ", username);
    console.log("modName: ", modName);

    let ogm = ctx.ogm;

    if (!commentId) {
      throw new Error(ERROR_MESSAGES.comment.noId);
    }
    const CommentModel = ogm.model("Comment");

    // Get the comment owner by using the OGM on the
    // Comment model.
    const comments: Comment[] = await CommentModel.find({
      where: { id: commentId },
      selectionSet: `{ 
        CommentAuthor {
          ... on User {
            username
          }
          ... on ModerationProfile {
            displayName
          }
        }
      }`,
    });

    if (!comments || comments.length === 0) {
      throw new Error(ERROR_MESSAGES.comment.notFound);
    }
    const comment = comments[0];

    // Get the comment author.
    const author = comment?.CommentAuthor;
    let authorUsername;
    let authorModProfileName;

    // The comment owner could be a user or a moderation profile.
    // For a user, the username is stored on the user object.
    // For a moderation profile, the displayName is stored on 
    // the moderation profile object.
    if (!author) {
      throw new Error(ERROR_MESSAGES.comment.noOwner);
    }

    // @ts-ignore
    if (author.username) {
      // @ts-ignore
      authorUsername = author.username;
    } else if (author.displayName) {
      authorModProfileName = author.displayName;
    } else {
      throw new Error(ERROR_MESSAGES.comment.noOwner);
    }

    // Check if the user is the comment author.
    if (authorUsername && authorUsername !== username) {
      throw new Error(ERROR_MESSAGES.comment.notOwner);
    }
    if (authorModProfileName && authorModProfileName !== modName) {
      throw new Error(ERROR_MESSAGES.comment.notOwner);
    }
    return true;
  }
);

interface IsAccountOwnerArgs {
  where: UserWhere;
  username: string;
}
// Check if the user is the owner of the account.
export const isAccountOwner = rule({ cache: "contextual" })(
  async (parent: any, args: IsAccountOwnerArgs, ctx: any, info: any) => {
    // When accessing nested fields like FavoriteChannels, the username comes from the parent User object
    const username  = parent?.username || args.where?.username || args.username;

    // set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    if (!username) {
      throw new Error(ERROR_MESSAGES.user.noUsername);
    }

    // Check if the user is the account owner.
    if (username !== ctx.user.username) {
      throw new Error(ERROR_MESSAGES.user.notOwner);
    }

    return true;
  }
);

type IsCollectionOwnerArgs = {
  where?: CollectionWhere;
  collectionId?: string;
  id?: string;
};

export const isCollectionOwner = rule({ cache: "contextual" })(
  async (parent: any, args: IsCollectionOwnerArgs, ctx: any, info: any) => {
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    const username = ctx.user?.username;

    if (!username) {
      throw new Error(ERROR_MESSAGES.user.noUsername);
    }

    const collectionIds: string[] = [];
    const whereArg = args?.where;

    if (whereArg?.id) {
      collectionIds.push(whereArg.id);
    }

    if (whereArg?.id_IN && Array.isArray(whereArg.id_IN)) {
      collectionIds.push(...whereArg.id_IN);
    }

    if (args?.collectionId) {
      collectionIds.push(args.collectionId);
    }

    if (args?.id) {
      collectionIds.push(args.id);
    }

    if (parent?.id && collectionIds.length === 0) {
      collectionIds.push(parent.id);
    }

    if (collectionIds.length === 0) {
      throw new Error(ERROR_MESSAGES.collection.noId);
    }

    const uniqueIds = [...new Set(collectionIds)];

    const CollectionModel = ctx.ogm.model("Collection");
    const whereClause: CollectionWhere =
      uniqueIds.length === 1
        ? { id: uniqueIds[0] }
        : { id_IN: uniqueIds };

    const collections: Collection[] = await CollectionModel.find({
      where: whereClause,
      selectionSet: `{ id CreatedBy { username } }`,
    });

    if (!collections || collections.length === 0) {
      throw new Error(ERROR_MESSAGES.collection.notFound);
    }

    if (collections.length !== uniqueIds.length) {
      throw new Error(ERROR_MESSAGES.collection.notFound);
    }

    const isOwner = collections.every(
      (collection) => collection?.CreatedBy?.username === username
    );

    if (!isOwner) {
      throw new Error(ERROR_MESSAGES.collection.notOwner);
    }

    return true;
  }
);

type IsDiscussionChannelOwnerInput = {
  where: DiscussionChannelWhere;
};

export const isDiscussionChannelOwner = rule({ cache: "contextual" })(
  async (parent: any, args: IsDiscussionChannelOwnerInput, ctx: any, info: any) => {
    // Set user data
    ctx.user = await setUserDataOnContext({
      context: ctx,
      getPermissionInfo: false,
    });

    let username = ctx.user.username;
    let ogm = ctx.ogm;
    
    // Extract the discussionId and channelUniqueName from the various possible argument formats
    let discussionId;
    let channelUniqueName;

    if (args.where) {
      discussionId = args.where.discussionId;
      channelUniqueName = args.where.channelUniqueName;
    }

    if (!discussionId || !channelUniqueName) {
      console.error("Missing discussionId or channelUniqueName in args:", args);
      return false;
    }

    try {
      // First check if the user is the owner of the discussion
      const DiscussionModel = ogm.model("Discussion");
      const discussions = await DiscussionModel.find({
        where: { id: discussionId },
        selectionSet: `{ 
          Author { 
            username
          } 
        }`,
      });

      const discussionAuthor = discussions[0]?.Author?.username

      if (discussions && discussions.length > 0) {
        const discussionOwner = discussionAuthor;
        if (discussionOwner === username) {
          return true;
        }
      }

      // Next check if the user is an admin of the channel
      const ChannelModel = ogm.model("Channel");
      const channels = await ChannelModel.find({
        where: { uniqueName: channelUniqueName },
        selectionSet: `{ 
          Admins { 
            username
          } 
        }`,
      });

      if (channels && channels.length > 0) {
        const channelAdmins = channels[0].Admins.map((admin: User) => admin.username);
        if (channelAdmins.includes(username)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error("Error in isDiscussionChannelOwner:", error);
      return false;
    }
  }
);
