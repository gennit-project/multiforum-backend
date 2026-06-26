import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import {
  Discussion,
  DiscussionWhere,
  DiscussionUpdateInput,
} from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { passesAsServerAdminOrRoot } from "../serverAdminOverride.js";

type IsDiscussionOwnerInput = {
  where: DiscussionWhere;
  discussionUpdateInput: DiscussionUpdateInput;
  channelConnections: string[];
  channelDisconnections: string[];
};

export const isDiscussionOwner = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsDiscussionOwnerInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    let discussionId;

    const { where } = args;
    if (where) {
      discussionId = where.id;
    }

    // set user data
    // Server admins and the env root pass any ownership-gated mutation (replaces isAdmin).
    if (await passesAsServerAdminOrRoot(ctx)) {
      return true;
    }

    ctx.user = await setUserDataOnContext({
      context: ctx,
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
