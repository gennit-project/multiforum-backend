// Content-creation graphql-shield rules (channel/discussion/event/comment).
// Extracted from rules/rules.ts.
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { hasServerPermission } from "../permission/hasServerPermission.js";
import { checkChannelPermissions } from "../permission/hasChannelPermission.js";
import { checkChannelModPermissions, ModChannelPermission } from "../permission/hasChannelModPermission.js";
import {
  CommentCreateInput,
  DiscussionCreateInput,
  EventCreateInput,
} from "../../src/generated/graphql.js";

export async function evaluateCanCreateChannelRule(ctx: GraphQLContext) {
  const hasPermissionToCreateChannels = await hasServerPermission(
    "canCreateChannel",
    ctx
  );

  if (hasPermissionToCreateChannels instanceof Error) {
    return hasPermissionToCreateChannels;
  }

  return true;
}

export const canCreateChannel = rule({ cache: "contextual" })(
  async (parent: unknown, args: unknown, ctx: GraphQLContext, info: GraphQLResolveInfo) =>
    evaluateCanCreateChannelRule(ctx)
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
  async (parent: unknown, args: CanCreateDiscussionArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
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
  async (parent: unknown, args: CanCreateEventArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
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
  async (parent: unknown, args: CanCreateCommentArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
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
