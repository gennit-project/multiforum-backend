import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { DiscussionChannelWhere, User } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { logger } from "../../../logger.js";

type IsDiscussionChannelOwnerInput = {
  where: DiscussionChannelWhere;
};

export const isDiscussionChannelOwner = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsDiscussionChannelOwnerInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
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
      logger.error("Missing discussionId or channelUniqueName in args:", args);
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
        if (channelAdmins.includes(username ?? "")) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error("Error in isDiscussionChannelOwner:", error);
      return false;
    }
  }
);
