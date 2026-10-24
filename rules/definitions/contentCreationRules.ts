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
import {
  resolveCommentCreationAuthorizationRepository,
  type DiscussionCommentTargetState,
} from "../../services/persistence/commentCreationAuthorizationRepository.js";

// Locked content is read-only and archived content is closed: no new comments
// (or replies) may be created on a locked/archived discussion, event, or
// comment. Throws with a clear reason. Mods who need to comment must unlock /
// unarchive first.
const assertParentNotLockedOrArchived = (
  entity: { locked?: boolean | null; archived?: boolean | null } | null | undefined,
  label: string
) => {
  if (entity?.locked) {
    throw new Error(`You cannot comment on a locked ${label}.`);
  }
  if (entity?.archived) {
    throw new Error(`You cannot comment on an archived ${label}.`);
  }
};

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
    // v7 dropped the nested to-one connect from the generated CommentCreateInput
    // types, but the comment-create flow still carries the client's chosen
    // target (Channel/DiscussionChannel/Event/ParentComment) as this connect
    // shape for authorization to inspect, so read it through a loose view.
    const firstItemInInput = input[0] as Record<string, any> | undefined;

    if (!firstItemInInput) {
      throw new Error("No comment create input found.");
    }

    const {
      DiscussionChannel,
      Event,
      GivesFeedbackOnEvent,
      GivesFeedbackOnDiscussion,
      GivesFeedbackOnComment,
      ParentComment,
      Channel,
    } = firstItemInInput;

    // Throw an error if no Channel is provided; all comments must be in the context of a channel.
    if (!Channel || !Channel.connect?.where?.node?.uniqueName) {
      throw new Error("Comment must be connected to a Channel.");
    }

    const repository = resolveCommentCreationAuthorizationRepository(ctx);

    // Replies cannot be made to an archived comment.
    const parentCommentId = ParentComment?.connect?.where?.node?.id;
    if (parentCommentId) {
      const parentComment =
        await repository.findParentCommentState(parentCommentId);
      if (!parentComment.found) {
        throw new Error("Could not find the comment being replied to.");
      }
      assertParentNotLockedOrArchived(parentComment, "comment");
    }

    let channelName = '';
    let discussionChannelState:
      | DiscussionCommentTargetState
      | undefined;

    // Determine if this is a feedback comment
    const isFeedbackComment = !!(GivesFeedbackOnEvent || GivesFeedbackOnDiscussion || GivesFeedbackOnComment);

    if (DiscussionChannel){
      const discussionChannelId = DiscussionChannel.connect?.where?.node?.id;

      if (!discussionChannelId) {
        throw new Error("No discussion channel ID found.");
      }

      discussionChannelState =
        await repository.findDiscussionChannelState(discussionChannelId);

      if (!discussionChannelState.found) {
        throw new Error("No discussion channel found.");
      }

      assertParentNotLockedOrArchived(
        discussionChannelState,
        "discussion"
      );

      channelName = discussionChannelState.channelUniqueName || '';
    }

    if (Event) {
      const eventId = Event.connect?.where?.node?.id;

      if (!eventId) {
        throw new Error("No event ID found.");
      }

      // Validate that the user has permission to comment on the event.
      // The channel that they are posting in needs to match one of the
      // channels that the event is connected to.
      const event = await repository.findEventChannelState(
        eventId,
        Channel.connect.where.node.uniqueName
      );

      if (!event.found) {
        throw new Error("Could not find the event submission in the given channel.");
      }

      assertParentNotLockedOrArchived(event, "event");

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
      const event = await repository.findEventChannelState(
        eventId,
        Channel.connect.where.node.uniqueName
      );

      if (!event.found) {
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

      discussionChannelState ??=
        await repository.findDiscussionChannelState(discussionChannelId);

      if (!discussionChannelState.found) {
        throw new Error("No discussion channel found.");
      }

      channelName = discussionChannelState.channelUniqueName || '';
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
