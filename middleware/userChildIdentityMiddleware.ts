import { Kind, valueFromASTUntyped, visit } from "graphql";
import type { GraphQLResolveInfo, SelectionSetNode, DirectiveNode } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import { rememberAccountChildIdentity } from "../services/accountChildIdentity.js";

// This pilot covers generated users reads and updateUsers responses. Other User-producing
// sources retain their existing behavior and are not certified by this adapter.
export const ownerProtectedUserFields = new Set([
  "FavoriteDiscussions", "FavoriteComments", "FavoriteDownloads", "FavoriteImages",
  "FavoriteImagesConnection", "FavoriteChannels", "OwnedDownloads", "Email",
  "stripeAccountId", "defaultLicense", "purchases", "library", "ModerationProfile",
  "enableSensitiveContentByDefault", "notifyOnReplyToCommentByDefault",
  "notifyOnReplyToDiscussionByDefault", "notifyOnReplyToEventByDefault",
  "notifyWhenTagged", "notifyOnSubscribedIssueUpdates", "notifyOnFeedback",
  "notificationBundleInterval", "notificationBundleEnabled", "notificationBundleContent",
]);

const identityDependentUserFields = new Set([...ownerProtectedUserFields, "Collections"]);

function isIncluded(directives: readonly DirectiveNode[] | undefined, info: GraphQLResolveInfo): boolean {
  return !(directives ?? []).some(directive => {
    const argument = directive.arguments?.find(arg => arg.name.value === "if");
    const value = argument && valueFromASTUntyped(argument.value, info.variableValues);
    return (directive.name.value === "skip" && value === true) ||
      (directive.name.value === "include" && value === false);
  });
}
function needsIdentity(selection: SelectionSetNode | undefined, info: GraphQLResolveInfo, seen = new Set<string>()): boolean {
  return selection?.selections.some(node => {
    if (!isIncluded(node.directives, info)) return false;
    if (node.kind === Kind.FIELD) return identityDependentUserFields.has(node.name.value);
    if (node.kind === Kind.INLINE_FRAGMENT) return needsIdentity(node.selectionSet, info, seen);
    if (seen.has(node.name.value)) return false;
    seen.add(node.name.value);
    return needsIdentity(info.fragments[node.name.value]?.selectionSet, info, seen);
  }) ?? false;
}

function isObjectSource(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function prepareIdentitySelection(nodes: GraphQLResolveInfo["fieldNodes"], info: GraphQLResolveInfo) {
  if (!nodes.some(node => needsIdentity(node.selectionSet, info))) return undefined;
  // Reserve an alias absent from the entire caller document, including fragments.
  // A caller's `username: bio` must never become the authorization identity.
  const names = new Set<string>();
  const collect = { Field(node: import("graphql").FieldNode) { names.add(node.alias?.value ?? node.name.value); } };
  visit(info.operation, collect);
  for (const fragment of Object.values(info.fragments)) visit(fragment, collect);
  let alias = "_accountIdentity";
  while (names.has(alias)) alias += "_";
  const fieldNodes = nodes.map(node => ({ ...node, selectionSet: {
    kind: Kind.SELECTION_SET,
    selections: [...(node.selectionSet?.selections ?? []), {
      kind: Kind.FIELD, name: { kind: Kind.NAME, value: "username" },
      alias: { kind: Kind.NAME, value: alias },
    }],
  } })) satisfies GraphQLResolveInfo["fieldNodes"];
  return { fieldNodes, alias };
}
function rememberRows(result: unknown, alias: string): void {
  if (Array.isArray(result)) {
    const rows: readonly unknown[] = result;
    for (const row of rows) if (isObjectSource(row)) {
      rememberAccountChildIdentity(row, alias in row ? row[alias] : undefined);
    }
  }
}

export async function resolveUsersWithChildIdentity(
  resolve: (parent: unknown, args: Record<string, unknown>, context: GraphQLContext, info: GraphQLResolveInfo) => unknown,
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
): Promise<unknown> {
  const selected = prepareIdentitySelection(info.fieldNodes, info);
  if (!selected) return resolve(parent, args, context, info);
  const result: unknown = await resolve(parent, args, context, { ...info, fieldNodes: selected.fieldNodes });
  // GraphQL retains requested-field completion, nullability and errors.
  rememberRows(result, selected.alias);
  return result;
}

type UserSourceSelection = {
  node: import("graphql").FieldNode;
  responsePath: readonly string[];
};

function sourceUserFields(
  selection: SelectionSetNode | undefined,
  info: GraphQLResolveInfo,
  path: readonly string[],
  responsePath: readonly string[] = [],
  seen = new Set<string>()
): UserSourceSelection[] {
  return (selection?.selections ?? []).flatMap(node => {
    if (!isIncluded(node.directives, info)) return [];
    if (node.kind === Kind.FIELD) {
      if (node.name.value !== path[0]) return [];
      const nextPath = [...responsePath, node.alias?.value ?? node.name.value];
      return path.length === 1 ? [{ node, responsePath: nextPath }] :
        sourceUserFields(node.selectionSet, info, path.slice(1), nextPath);
    }
    if (node.kind === Kind.INLINE_FRAGMENT) return sourceUserFields(node.selectionSet, info, path, responsePath, seen);
    if (seen.has(node.name.value)) return [];
    const nextSeen = new Set(seen).add(node.name.value);
    return sourceUserFields(info.fragments[node.name.value]?.selectionSet, info, path, responsePath, nextSeen);
  });
}

function rememberPath(value: unknown, path: readonly string[], alias: string): void {
  if (Array.isArray(value)) {
    const values: readonly unknown[] = value;
    for (const item of values) rememberPath(item, path, alias);
  } else if (isObjectSource(value)) {
    if (path.length) rememberPath(value[path[0]], path.slice(1), alias);
    else rememberAccountChildIdentity(value, alias in value ? value[alias] : undefined);
  }
}

/** Each registration names a verified source path, not arbitrary descendant objects. */
export function userChildIdentityAtPath(
  path: readonly string[],
  sourceKeys: "response" | "canonical" = "response"
): typeof resolveUsersWithChildIdentity {
  if (!path.length) throw new Error("A nested User source path is required");
  return async (resolve, parent, args, context, info) => {
    const sources = info.fieldNodes.flatMap(node => sourceUserFields(node.selectionSet, info, path));
    const selected = prepareIdentitySelection(sources.map(source => source.node), info);
    if (!selected) return resolve(parent, args, context, info);
    const replacements = new Map(sources.map((source, index) => [source.node, selected.fieldNodes[index]]));
    const visitor = { Field(node: import("graphql").FieldNode) { return replacements.get(node); } };
    const fieldNodes = info.fieldNodes.map(node => visit(node, visitor));
    const fragments = Object.fromEntries(Object.entries(info.fragments).map(([name, node]) => [name, visit(node, visitor)]));
    const result: unknown = await resolve(parent, args, context, { ...info, fieldNodes, fragments });
    for (const source of sources) rememberPath(result, sourceKeys === "canonical" ? path : source.responsePath, selected.alias);
    return result;
  };
}

export const resolveUpdatedUsersWithChildIdentity = userChildIdentityAtPath(["users"]);
// Neo4j root connections return canonical edges/node keys even when the caller
// aliases them. Update payloads and ordinary projections use response keys.
export const resolveUserConnectionWithChildIdentity = userChildIdentityAtPath(["edges", "node"], "canonical");

export default {
  Query: {
    users: resolveUsersWithChildIdentity,
    usersConnection: resolveUserConnectionWithChildIdentity,
  },
  Mutation: { updateUsers: resolveUpdatedUsersWithChildIdentity },
};
