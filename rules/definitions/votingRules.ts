// Upvote graphql-shield rules. Extracted from rules/rules.ts.
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { hasChannelPermission } from "../permission/hasChannelPermission.js";

type CanUpvoteCommentArgs = {
  commentId: string;
  username: string;
};

export const canUpvoteComment = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanUpvoteCommentArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
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
      throw new Error(ERROR_MESSAGES.channel.noChannelPermission);
    }

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
  }
);
