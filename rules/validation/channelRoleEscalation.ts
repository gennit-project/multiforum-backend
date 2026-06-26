// No-privilege-escalation guard for CHANNEL role authoring (PR-4c; extends PR-4
// to the channel scope — docs/isadmin-phaseout-design.md §5).
//
// `createChannelRoles` / `createModChannelRoles` are gated by the server-level
// `canManageRoles`, but a channel role is fundamentally the channel owner's to
// define. Channel roles carry NO server-administration capability, so they can
// never reach the apex tier — this is defense-in-depth. The invariant: you may
// author a capability-bearing channel role only for a channel you own (or as a
// server admin / root, who hold every channel capability everywhere). A non-owner
// with `canManageRoles` can still create empty/no-capability roles.
//
// (Wiring a channel role into a channel is separately channel-owner-gated via
// updateChannels, and createChannels makes the caller the owner — so nested
// channel-role writes there need no guard.)
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import {
  CHANNEL_ROLE_CAPABILITY_FIELDS,
  MOD_CHANNEL_ROLE_CAPABILITY_FIELDS,
} from "../permission/actorCapabilities.js";
import { passesAsServerAdminOrRoot } from "../permission/serverAdminOverride.js";
import { isChannelAdmin } from "../permission/hasChannelPermission.js";
import { setUserDataOnContext } from "../permission/userDataHelperFunctions.js";

type RoleItem = Record<string, unknown>;

// --- Pure: which input items actually grant a capability (extracted for tests) ---

export function roleItemsGrantingCapabilities(
  items: unknown,
  capabilityFields: readonly string[]
): RoleItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return (items as RoleItem[]).filter(
    (item) =>
      !!item &&
      typeof item === "object" &&
      capabilityFields.some((field) => item[field] === true)
  );
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

const channelRoleEscalationRule = (capabilityFields: readonly string[]) =>
  rule({ cache: "contextual" })(
    async (
      _parent: unknown,
      args: Record<string, unknown>,
      ctx: GraphQLContext,
      _info: GraphQLResolveInfo
    ) => {
      const capabilityItems = roleItemsGrantingCapabilities(
        args.input,
        capabilityFields
      );
      // Roles that grant nothing are harmless to author.
      if (capabilityItems.length === 0) {
        return true;
      }

      // Server admins and root hold every channel capability everywhere, so they
      // may author any channel role. (This also populates ctx.user.)
      if (await passesAsServerAdminOrRoot(ctx)) {
        return true;
      }
      if (!ctx.user?.username) {
        ctx.user = await setUserDataOnContext({ context: ctx });
      }

      // Otherwise every capability-bearing role must target a channel the caller
      // owns. A channel owner inherently holds all of their channel's
      // capabilities, so ownership is the capability check for the channel scope.
      for (const item of capabilityItems) {
        if (!(await ownsChannel(ctx, item.channelUniqueName))) {
          return "You can only author channel roles that grant capabilities for a channel you own.";
        }
      }

      return true;
    }
  );

export const channelRoleInputDoesNotEscalate = channelRoleEscalationRule(
  CHANNEL_ROLE_CAPABILITY_FIELDS
);

export const modChannelRoleInputDoesNotEscalate = channelRoleEscalationRule(
  MOD_CHANNEL_ROLE_CAPABILITY_FIELDS
);
