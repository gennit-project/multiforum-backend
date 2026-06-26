// No-privilege-escalation guard for NESTED role writes (PR-4b; extends PR-4 /
// docs/isadmin-phaseout-design.md §5).
//
// PR-4 guards the top-level role-authoring mutations, but the auto-generated
// `ServerConfigUpdateInput` / `ServerConfigCreateInput` also allow nested
// role writes on the tier relationships:
//
//   updateServerConfigs(update: {
//     DefaultAdminRole: { update: { node: { canManageAdmins: true } } }
//   })
//
// That path is gated only by `canManageServerSettings`, so without this guard a
// restricted admin could edit the shared `DefaultAdminRole` (or connect an
// existing powerful role into a tier slot) and escalate the whole admin tier.
//
// This guard walks the ServerConfig input's role relationships and rejects any
// nested create/update/connectOrCreate role node — and any connect target
// resolved from the database — that grants a capability the actor lacks. Root /
// full admin bypass; resolution failures fail closed.
//
// Channel mutations are intentionally out of scope: Channel only links
// ChannelRole / ModChannelRole, which carry no server-administration capability,
// so they cannot reach the apex tier (see §5 follow-up notes).
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
import { findEscalatedCapabilities } from "./roleEscalation.js";

// ServerConfig tier relationships, by the role type they connect.
export const SERVER_CONFIG_SERVER_ROLE_RELATIONSHIPS = [
  "DefaultServerRole",
  "DefaultAdminRole",
  "DefaultSuperAdminRole",
  "DefaultSuspendedRole",
] as const;

export const SERVER_CONFIG_MOD_ROLE_RELATIONSHIPS = [
  "DefaultModRole",
  "DefaultElevatedModRole",
  "DefaultSuspendedModRole",
] as const;

type RoleNode = Record<string, unknown>;
type WhereNode = Record<string, unknown>;

export type ExtractedRoleWrites = {
  // Capability-bearing nodes (create / update / connectOrCreate.onCreate).
  serverRoleNodes: RoleNode[];
  modServerRoleNodes: RoleNode[];
  // `where` clauses that connect an EXISTING role (connect / connectOrCreate),
  // whose capabilities must be resolved from the database.
  serverRoleConnectWheres: WhereNode[];
  modServerRoleConnectWheres: WhereNode[];
};

const toArray = <T>(value: T | T[] | null | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

// Pulls the capability-bearing nodes and connect `where`s out of a single
// relationship field input (create | update | connect | connectOrCreate), for
// both the create-input and update-input shapes.
function collectFromRelationshipField(
  fieldInput: unknown,
  nodes: RoleNode[],
  connectWheres: WhereNode[]
): void {
  for (const op of toArray(fieldInput) as Array<Record<string, unknown>>) {
    if (!op || typeof op !== "object") {
      continue;
    }

    for (const create of toArray(op.create) as Array<Record<string, unknown>>) {
      if (create?.node && typeof create.node === "object") {
        nodes.push(create.node as RoleNode);
      }
    }

    for (const update of toArray(op.update) as Array<Record<string, unknown>>) {
      if (update?.node && typeof update.node === "object") {
        nodes.push(update.node as RoleNode);
      }
    }

    for (const coc of toArray(op.connectOrCreate) as Array<Record<string, unknown>>) {
      const onCreate = coc?.onCreate as Record<string, unknown> | undefined;
      if (onCreate?.node && typeof onCreate.node === "object") {
        nodes.push(onCreate.node as RoleNode);
      }
      const where = coc?.where as Record<string, unknown> | undefined;
      if (where?.node && typeof where.node === "object") {
        connectWheres.push(where.node as WhereNode);
      }
    }

    for (const connect of toArray(op.connect) as Array<Record<string, unknown>>) {
      const where = connect?.where as Record<string, unknown> | undefined;
      if (where?.node && typeof where.node === "object") {
        connectWheres.push(where.node as WhereNode);
      }
    }
  }
}

// --- Pure extraction (unit tested) ---

export function extractNestedRoleWrites(input: unknown): ExtractedRoleWrites {
  const result: ExtractedRoleWrites = {
    serverRoleNodes: [],
    modServerRoleNodes: [],
    serverRoleConnectWheres: [],
    modServerRoleConnectWheres: [],
  };

  if (!input || typeof input !== "object") {
    return result;
  }
  const obj = input as Record<string, unknown>;

  for (const field of SERVER_CONFIG_SERVER_ROLE_RELATIONSHIPS) {
    collectFromRelationshipField(
      obj[field],
      result.serverRoleNodes,
      result.serverRoleConnectWheres
    );
  }
  for (const field of SERVER_CONFIG_MOD_ROLE_RELATIONSHIPS) {
    collectFromRelationshipField(
      obj[field],
      result.modServerRoleNodes,
      result.modServerRoleConnectWheres
    );
  }

  return result;
}

function mergeWrites(target: ExtractedRoleWrites, source: ExtractedRoleWrites): void {
  target.serverRoleNodes.push(...source.serverRoleNodes);
  target.modServerRoleNodes.push(...source.modServerRoleNodes);
  target.serverRoleConnectWheres.push(...source.serverRoleConnectWheres);
  target.modServerRoleConnectWheres.push(...source.modServerRoleConnectWheres);
}

// Resolves the capabilities of existing roles targeted by a connect `where`, so
// connecting a powerful role into a tier slot is caught. Throws on lookup
// failure so the shield rule fails closed.
async function resolveConnectedRoleNodes(
  ctx: GraphQLContext,
  modelName: "ServerRole" | "ModServerRole",
  wheres: WhereNode[],
  capabilityFields: readonly string[]
): Promise<RoleNode[]> {
  if (wheres.length === 0) {
    return [];
  }

  const Model = ctx.ogm.model(modelName);
  const selectionSet = `{ ${capabilityFields.join("\n")} }`;
  const resolved: RoleNode[] = [];

  for (const where of wheres) {
    const roles = (await Model.find({ where, selectionSet })) as RoleNode[];
    resolved.push(...roles);
  }

  return resolved;
}

type RoleEscalationCheck = {
  nodes: RoleNode[];
  connectWheres: WhereNode[];
  modelName: "ServerRole" | "ModServerRole";
  capabilityFields: readonly string[];
  actorRole: EffectiveRole;
};

async function collectEscalations(
  ctx: GraphQLContext,
  check: RoleEscalationCheck
): Promise<string[]> {
  const { nodes, connectWheres, modelName, capabilityFields, actorRole } = check;

  // A caller who already holds every capability (root / full admin) can never
  // escalate, so skip the database round-trips for connect resolution.
  if (actorRole === "all") {
    return [];
  }

  const connectedNodes = await resolveConnectedRoleNodes(
    ctx,
    modelName,
    connectWheres,
    capabilityFields
  );

  return findEscalatedCapabilities({
    requested: [...nodes, ...connectedNodes],
    capabilityFields,
    actorRole,
  });
}

export const serverConfigInputDoesNotEscalate = rule({ cache: "contextual" })(
  async (
    _parent: unknown,
    args: Record<string, unknown>,
    ctx: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const inputs: unknown[] = [];
    if (Array.isArray(args.input)) {
      inputs.push(...(args.input as unknown[]));
    }
    if (args.update) {
      inputs.push(args.update);
    }

    const writes: ExtractedRoleWrites = {
      serverRoleNodes: [],
      modServerRoleNodes: [],
      serverRoleConnectWheres: [],
      modServerRoleConnectWheres: [],
    };
    for (const input of inputs) {
      mergeWrites(writes, extractNestedRoleWrites(input));
    }

    const touchesRoles =
      writes.serverRoleNodes.length > 0 ||
      writes.modServerRoleNodes.length > 0 ||
      writes.serverRoleConnectWheres.length > 0 ||
      writes.modServerRoleConnectWheres.length > 0;
    if (!touchesRoles) {
      return true;
    }

    const [actorServerRole, actorModRole] = await Promise.all([
      getActorServerRoleCaps(ctx),
      getActorModServerRoleCaps(ctx),
    ]);

    const escalated = new Set<string>();

    const serverEscalations = await collectEscalations(ctx, {
      nodes: writes.serverRoleNodes,
      connectWheres: writes.serverRoleConnectWheres,
      modelName: "ServerRole",
      capabilityFields: SERVER_ROLE_CAPABILITY_FIELDS,
      actorRole: actorServerRole,
    });
    serverEscalations.forEach((capability) => escalated.add(capability));

    const modEscalations = await collectEscalations(ctx, {
      nodes: writes.modServerRoleNodes,
      connectWheres: writes.modServerRoleConnectWheres,
      modelName: "ModServerRole",
      capabilityFields: MOD_SERVER_ROLE_CAPABILITY_FIELDS,
      actorRole: actorModRole,
    });
    modEscalations.forEach((capability) => escalated.add(capability));

    if (escalated.size > 0) {
      return `You cannot grant capabilities you do not have yourself: ${[
        ...escalated,
      ].join(", ")}.`;
    }

    return true;
  }
);
