import { checkChannelModPermissions } from "./hasChannelModPermission.js";
import { ModChannelPermission } from "./hasChannelModPermission.js";
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { getServerScopedMembership } from "./getServerScopedMembership.js";
import { hasServerModPermission } from "./hasServerModPermission.js";
import { logger } from "../../logger.js";

// Helper function to check if a user is a channel owner
async function isUserChannelOwner(username: string, channelName: string, context: GraphQLContext): Promise<boolean> {
  const Channel = context.ogm.model("Channel");
  
  const channel = await Channel.find({
    where: { uniqueName: channelName },
    selectionSet: `{ 
      Admins { 
        username
      } 
    }`,
  });

  if (!channel || !channel[0]) {
    return false;
  }

  const channelOwners = channel[0].Admins.map((admin: { username: string }) => admin.username);
  return channelOwners.includes(username);
}

// Helper function to check if current user is a site admin
async function isUserSiteAdmin(context: GraphQLContext): Promise<boolean> {
  const membership = await getServerScopedMembership(context);
  return membership.isServerAdmin;
}

async function isUserServerAdmin(username: string, context: GraphQLContext): Promise<boolean> {
  const ServerConfig = context.ogm.model("ServerConfig");
  const serverConfigs = await ServerConfig.find({
    where: { serverName: process.env.SERVER_CONFIG_NAME },
    selectionSet: `{
      Admins {
        username
      }
    }`,
  });

  const serverConfig = serverConfigs?.[0];
  return (
    serverConfig?.Admins?.some((admin: { username: string }) => admin.username === username) ??
    false
  );
}

export type SuspendUserDecision =
  | { type: "allow" }
  | { type: "deny"; error: Error }
  | { type: "delegateServer" }
  | { type: "delegateChannel" };

// Pure decision for suspend/unsuspend. The rule resolves the channel and looks
// up the relevant admin/owner flags (in the same conditional order as before),
// then this maps them to a verdict — or to which async permission check the
// rule should delegate to. Channel owners and server admins can only be
// suspended by site admins.
export function evaluateCanSuspendUser(input: {
  hasChannel: boolean;
  targetUsername?: string;
  targetIsServerAdmin: boolean;
  isChannelOwner: boolean;
  isSiteAdmin: boolean;
}): SuspendUserDecision {
  const {
    hasChannel,
    targetUsername,
    targetIsServerAdmin,
    isChannelOwner,
    isSiteAdmin,
  } = input;

  if (!hasChannel) {
    if (targetUsername && targetIsServerAdmin) {
      if (!isSiteAdmin) {
        return {
          type: "deny",
          error: new Error(ERROR_MESSAGES.channel.cantSuspendOwner),
        };
      }
      return { type: "allow" };
    }
    return { type: "delegateServer" };
  }

  if (targetUsername && isChannelOwner) {
    if (!isSiteAdmin) {
      return {
        type: "deny",
        error: new Error(ERROR_MESSAGES.channel.cantSuspendOwner),
      };
    }
    return { type: "allow" };
  }

  return { type: "delegateChannel" };
}

interface CanSuspendAndUnsuspendUserArgs {
  channelUniqueName?: string;
  issueId?: string;
  username?: string;
}

export const canSuspendAndUnsuspendUser = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanSuspendAndUnsuspendUserArgs, context: GraphQLContext, info: GraphQLResolveInfo) => {
    let channelUniqueName = args.channelUniqueName;
    const issueId = args.issueId;
    const targetUsername = args.username; // The username of the user to be suspended
    
    logger.info('can suspend and unsuspend user');
    logger.info("channelUniqueName", channelUniqueName);
    logger.info("issueId", issueId);
    logger.info("targetUsername", targetUsername);
    
    // If channelUniqueName is not provided, look it up from the issue
    if (!channelUniqueName && issueId) {
      const Issue = context.ogm.model("Issue");
      const issue = await Issue.find({
        where: { id: issueId },
        selectionSet: `{ 
          channelUniqueName
        }`,
      });

      if (!issue || !issue[0]) {
        return new Error("Could not find the issue or its associated channel.");
      }

      channelUniqueName = issue[0].channelUniqueName ?? undefined;
    }

    // Look up the admin/owner flags the decision needs, in the same conditional
    // order as before so no extra queries run. isSiteAdmin is only fetched when
    // the target is a protected owner/admin, matching the original.
    const hasChannel = Boolean(channelUniqueName);
    let targetIsServerAdmin = false;
    let isChannelOwner = false;
    let isSiteAdmin = false;

    if (!hasChannel) {
      if (targetUsername) {
        targetIsServerAdmin = await isUserServerAdmin(targetUsername, context);
        if (targetIsServerAdmin) {
          isSiteAdmin = await isUserSiteAdmin(context);
        }
      }
    } else if (targetUsername) {
      isChannelOwner = await isUserChannelOwner(
        targetUsername,
        channelUniqueName ?? "",
        context
      );
      if (isChannelOwner) {
        isSiteAdmin = await isUserSiteAdmin(context);
      }
    }

    const decision = evaluateCanSuspendUser({
      hasChannel,
      targetUsername,
      targetIsServerAdmin,
      isChannelOwner,
      isSiteAdmin,
    });

    if (decision.type === "allow") {
      return true;
    }
    if (decision.type === "deny") {
      return decision.error;
    }
    if (decision.type === "delegateServer") {
      return hasServerModPermission("canSuspendUser", context);
    }

    // delegateChannel: fall back to the regular channel mod permission check.
    const permissionResult = await checkChannelModPermissions({
      channelConnections: [channelUniqueName ?? ""],
      context,
      permissionCheck: ModChannelPermission.canSuspendUser,
    });

    if (permissionResult instanceof Error) {
      return permissionResult;
    }

    return true;
}
);
