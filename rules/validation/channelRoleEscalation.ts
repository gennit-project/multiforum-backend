// No-privilege-escalation guard for CHANNEL role authoring (PR-4c; extends PR-4
// to the channel scope — docs/isadmin-phaseout-design.md §5).
//
// A channel role is fundamentally the channel owner's to define. Channel roles
// carry no server-administration capability, so they can never reach the apex
// tier. Ownership is taken from the explicit Owner connection; the scalar is
// only an immutable identity key.
//
// (Wiring a channel role into a channel is separately channel-owner-gated via
// updateChannels, and createChannels makes the caller the owner — so nested
// channel-role writes there need no guard.)
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { passesAsServerAdminOrRoot } from "../permission/serverAdminOverride.js";
import { isChannelAdmin } from "../permission/hasChannelPermission.js";
import { setUserDataOnContext } from "../permission/userDataHelperFunctions.js";
import { getConnectedOwnerChannelNames } from "../../middleware/channelRoleOwnershipMiddleware.js";

type RoleItem = Record<string, unknown>;

export function roleOwnerChannelNames(items: unknown): string[] | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const ownerNames = (items as RoleItem[]).map((item) => {
    if (!item || typeof item !== "object") return null;
    const connectedOwners = getConnectedOwnerChannelNames(item.Owner);
    if (
      connectedOwners.length !== 1 ||
      (item.channelUniqueName && item.channelUniqueName !== connectedOwners[0])
    ) return null;
    return connectedOwners[0];
  });
  return ownerNames.some((owner) => !owner) ? null : ownerNames as string[];
}

// True when the caller is listed among the channel's owners (Admins).
async function ownsChannel(
  ctx: GraphQLContext,
  channelUniqueName: unknown
): Promise<boolean> {
  if (typeof channelUniqueName !== "string" || !channelUniqueName) {
    return false;
  }
  const username = ctx.user?.username;
  if (!username) {
    return false;
  }
  const Channel = ctx.ogm.model("Channel");
  const channels = (await Channel.find({
    where: { uniqueName: channelUniqueName },
    selectionSet: `{ Admins { username } }`,
  })) as Array<{ Admins?: Array<{ username?: string | null }> | null }>;

  return isChannelAdmin(channels?.[0]?.Admins, username);
}

const channelRoleEscalationRule = () =>
  rule({ cache: "contextual" })(
    async (
      _parent: unknown,
      args: Record<string, unknown>,
      ctx: GraphQLContext,
      _info: GraphQLResolveInfo
    ) => {
      const ownerNames = roleOwnerChannelNames(args.input);
      if (!ownerNames) {
        return "Each channel role must connect to exactly one owner matching channelUniqueName.";
      }

      // Server admins and root hold every channel capability everywhere, so they
      // may author any channel role. (This also populates ctx.user.)
      if (await passesAsServerAdminOrRoot(ctx)) {
        return true;
      }
      if (!ctx.user?.username) {
        ctx.user = await setUserDataOnContext({ context: ctx });
      }

      // Otherwise every role must be created for a channel the caller owns.
      for (const ownerName of ownerNames) {
        if (!(await ownsChannel(ctx, ownerName))) {
          return "You can only author channel roles for a channel you own.";
        }
      }

      return true;
    }
  );

export const channelRoleInputDoesNotEscalate = channelRoleEscalationRule();

export const modChannelRoleInputDoesNotEscalate = channelRoleEscalationRule();

const channelRoleTargetIsOwnedRule = (
  modelName: "ChannelRole" | "ModChannelRole"
) => rule({ cache: "contextual" })(
  async (
    _parent: unknown,
    args: Record<string, unknown>,
    ctx: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    if (await passesAsServerAdminOrRoot(ctx)) {
      return true;
    }
    if (!ctx.user?.username) {
      ctx.user = await setUserDataOnContext({ context: ctx });
    }
    const roles = await ctx.ogm.model(modelName).find({
      where: args.where as any,
      selectionSet: `{ Owner { uniqueName } }`,
    }) as Array<{ Owner?: { uniqueName?: string | null } | null }>;
    if (roles.length === 0) {
      return "Channel role not found.";
    }
    for (const role of roles) {
      if (!(await ownsChannel(ctx, role.Owner?.uniqueName))) {
        return "You can only change channel roles owned by a channel you own.";
      }
    }
    return true;
  }
);

export const channelRoleTargetIsOwned =
  channelRoleTargetIsOwnedRule("ChannelRole");
export const modChannelRoleTargetIsOwned =
  channelRoleTargetIsOwnedRule("ModChannelRole");
