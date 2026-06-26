// No-privilege-escalation guard (docs/isadmin-phaseout-design.md §5).
//
// The role create/update mutations are gated by `canManageRoles`, but that only
// asks "may you manage roles?" — not "may you grant THIS capability?". Without a
// further check, a restricted admin with `canManageRoles` could author a role
// that grants `canManageAdmins` (or any capability they lack) and escalate.
//
// This guard rejects any role input that sets a capability flag to `true` which
// the actor does not themselves hold. Root holds everything and always passes;
// if the actor's own role cannot be resolved, the guard fails closed (every
// requested capability counts as an escalation).
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import {
  SERVER_ROLE_CAPABILITY_FIELDS,
  MOD_SERVER_ROLE_CAPABILITY_FIELDS,
  getActorServerRoleCaps,
  getActorModServerRoleCaps,
  type EffectiveRole,
} from "../permission/actorCapabilities.js";

// --- Pure decision (extracted for unit testing) ---

/**
 * Returns the capabilities the input tries to grant that the actor does not
 * hold. An empty array means no escalation. `actorRole === "all"` (root / full
 * admin) never escalates; a `null` actor role grants nothing, so every requested
 * capability is flagged (fail closed).
 */
export function findEscalatedCapabilities(input: {
  requested: Array<Record<string, unknown> | null | undefined>;
  capabilityFields: readonly string[];
  actorRole: EffectiveRole;
}): string[] {
  const { requested, capabilityFields, actorRole } = input;

  if (actorRole === "all") {
    return [];
  }

  const granted = actorRole ?? {};
  const escalated = new Set<string>();

  for (const item of requested) {
    if (!item) {
      continue;
    }
    for (const field of capabilityFields) {
      if (item[field] === true && granted[field] !== true) {
        escalated.add(field);
      }
    }
  }

  return [...escalated];
}

// Collects the role objects carried by a create (`input: [...]`) or update
// (`update: {...}`) mutation.
export function collectRequestedRoles(
  args: Record<string, unknown>
): Array<Record<string, unknown>> {
  const requested: Array<Record<string, unknown>> = [];
  if (Array.isArray(args.input)) {
    requested.push(...(args.input as Array<Record<string, unknown>>));
  }
  if (args.update && typeof args.update === "object") {
    requested.push(args.update as Record<string, unknown>);
  }
  return requested;
}

type RoleEscalationRuleInput = {
  capabilityFields: readonly string[];
  getActorRole: (ctx: GraphQLContext) => Promise<EffectiveRole>;
};

const roleEscalationRule = ({
  capabilityFields,
  getActorRole,
}: RoleEscalationRuleInput) =>
  rule({ cache: "contextual" })(
    async (
      _parent: unknown,
      args: Record<string, unknown>,
      ctx: GraphQLContext,
      _info: GraphQLResolveInfo
    ) => {
      const requested = collectRequestedRoles(args);
      if (requested.length === 0) {
        return true;
      }

      const actorRole = await getActorRole(ctx);
      const escalated = findEscalatedCapabilities({
        requested,
        capabilityFields,
        actorRole,
      });

      if (escalated.length > 0) {
        return `You cannot grant capabilities you do not have yourself: ${escalated.join(
          ", "
        )}.`;
      }

      return true;
    }
  );

export const serverRoleInputDoesNotEscalate = roleEscalationRule({
  capabilityFields: SERVER_ROLE_CAPABILITY_FIELDS,
  getActorRole: getActorServerRoleCaps,
});

export const modServerRoleInputDoesNotEscalate = roleEscalationRule({
  capabilityFields: MOD_SERVER_ROLE_CAPABILITY_FIELDS,
  getActorRole: getActorModServerRoleCaps,
});
