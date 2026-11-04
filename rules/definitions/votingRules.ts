// Upvote graphql-shield rules. Extracted from rules/rules.ts.
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { setUserDataOnContext } from "../permission/userDataHelperFunctions.js";
import { hasChannelPermission } from "../permission/hasChannelPermission.js";
import { resolveContentChannelPermissionRepository } from "../../services/persistence/contentChannelPermissionRepository.js";

const assertVoteActor = async (context: GraphQLContext, username: string) => {
  // Shield may evaluate sibling rules concurrently. Resolve through the same
  // request identity cache rather than relying on isAuthenticated finishing first.
  if (!context.user?.data) {
    context.user = await setUserDataOnContext({ context });
  }
  if (!context.user?.username || context.user.username !== username) {
    throw new Error("You may only change your own votes and reactions.");
  }
};

type CanUpvoteCommentArgs = {
  commentId: string;
  username: string;
};

export const canUpvoteComment = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanUpvoteCommentArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const { commentId, username } = args;

    if (!commentId || !username) {
      throw new Error("All arguments (commentId, username) are required");
    }

    await assertVoteActor(ctx, username);
    const repository = resolveContentChannelPermissionRepository(ctx);
    const commentData = await repository.findCommentChannelReferences(commentId);

    if (!commentData.found) {
      throw new Error("No comment found.");
    }

    // Try to get channel name either from DiscussionChannel or directly from Channel
    let channelThatCommentIsIn = commentData.discussionChannelUniqueName;

    // If not found in DiscussionChannel, try the direct Channel relationship
    if (!channelThatCommentIsIn) {
      channelThatCommentIsIn = commentData.directChannelUniqueName;
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
      throw new Error(ERROR_MESSAGES.channel.noChannelPermission);
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);

type CanSuperUpvoteArgs = {
  sourceType: "comment" | "discussion";
  sourceId: string;
  sourceChannelUniqueName?: string | null;
};

// Super upvoting is a second vote, so it requires the same channel permission as
// a normal upvote (this blocks suspended users from super upvoting). The mutation
// handles both comments and discussions, so resolve the channel + permission from
// the source type. Reused for undoSuperUpvote, which sends the same args.
export const canSuperUpvote = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanSuperUpvoteArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const { sourceType, sourceId } = args;

    if (!sourceType || !sourceId) {
      throw new Error("sourceType and sourceId are required");
    }

    // The optional display/navigation hint is not an authorization target.
    let channelName: string | undefined;
    let permission: "canUpvoteComment" | "canUpvoteDiscussion";

    if (sourceType === "comment") {
      permission = "canUpvoteComment";
      const repository = resolveContentChannelPermissionRepository(ctx);
      const commentData = await repository.findCommentChannelReferences(sourceId);
      channelName = commentData.discussionChannelUniqueName ||
        commentData.directChannelUniqueName || undefined;
    } else if (sourceType === "discussion") {
      permission = "canUpvoteDiscussion";
      const repository = resolveContentChannelPermissionRepository(ctx);
      const discussionChannel = await repository.findDiscussionChannelReference(sourceId);
      channelName = discussionChannel.channelUniqueName || undefined;
    } else {
      throw new Error('sourceType must be "comment" or "discussion"');
    }

    if (!channelName) {
      throw new Error("No channel found.");
    }

    const permissionResult = await hasChannelPermission({
      permission,
      channelName,
      context: ctx,
    });

    if (!permissionResult) {
      throw new Error(ERROR_MESSAGES.channel.noChannelPermission);
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

export const canUpvoteDiscussion = rule({ cache: "contextual" })(
  async (
    parent: unknown,
    args: CanUpvoteDiscussionChannelArgs,
    ctx: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    // get channel name from discussion channel id
    const { discussionChannelId, username } = args;

    if (!discussionChannelId || !username) {
      throw new Error(
        "All arguments (discussionChannelId, username) are required"
      );
    }

    await assertVoteActor(ctx, username);
    const repository = resolveContentChannelPermissionRepository(ctx);
    const discussionChannelData =
      await repository.findDiscussionChannelReference(discussionChannelId);

    if (!discussionChannelData.found) {
      throw new Error("No discussion channel found.");
    }

    const channelName = discussionChannelData.channelUniqueName;

    if (!channelName) {
      throw new Error("No channel found.");
    }

    const permissionResult = await hasChannelPermission({
      permission: "canUpvoteDiscussion",
      channelName,
      context: ctx,
    });

    if (!permissionResult) {
      throw new Error(ERROR_MESSAGES.channel.noChannelPermission);
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);
