import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { ChannelWhere, Channel } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";
import { passesAsServerAdminOrRoot } from "../serverAdminOverride.js";
import { logger } from "../../../logger.js";

type IsChannelOwnerInput = {
  where: ChannelWhere;
  channelUniqueName: string;
  issueId?: string;
  commentId?: string;
};

export const isChannelOwner = rule({ cache: "contextual" })(
  async (parent: unknown, args: IsChannelOwnerInput, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    logger.info('🔐 isChannelOwner rule called with args:', JSON.stringify(args));

    // set user data
    // Server admins and the env root pass any ownership-gated mutation (replaces isAdmin).
    if (await passesAsServerAdminOrRoot(ctx)) {
      return true;
    }

    ctx.user = await setUserDataOnContext({
      context: ctx,
    });
    let username = ctx.user.username;
    logger.info("username: ", ctx.user);

    let ogm = ctx.ogm;
    const { where, channelUniqueName, issueId, commentId } = args;
    logger.info('args: ', JSON.stringify(args));
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
                  comment[0]?.Channel?.uniqueName || "";

      if (!uniqueName) {
        throw new Error(ERROR_MESSAGES.channel.notFound);
      }
    }

    // If no channel name is provided but we have an issueId, look it up
    // Also check where.id for mutations like updateIssues that pass issue ID in where clause
    const resolvedIssueId = issueId || (where as any)?.id;
    if (!uniqueName && resolvedIssueId) {
      const Issue = ogm.model("Issue");
      const issue = await Issue.find({
        where: { id: resolvedIssueId },
        selectionSet: `{
          channelUniqueName
        }`,
      });
      logger.info('issue', JSON.stringify(issue));

      if (!issue || !issue[0]) {
        // Return false instead of throwing to allow OR chain to continue
        return false;
      }

      uniqueName = issue[0].channelUniqueName ?? "";
    }

    if (!uniqueName) {
      // Return false instead of throwing to allow OR chain to continue
      return false;
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
    if (!channelOwners.includes(username ?? "")) {
      return false;  // Permission check - return false to allow OR to work
    }

    return true;
  }
);
