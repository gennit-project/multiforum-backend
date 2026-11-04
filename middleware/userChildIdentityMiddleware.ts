import { Kind, valueFromASTUntyped, visit } from "graphql";
import type { GraphQLResolveInfo, SelectionSetNode, DirectiveNode } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import { rememberAccountChildIdentity } from "../services/accountChildIdentity.js";

// This pilot covers the generated Query.users source. Other User-producing
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
    if (node.kind === Kind.FIELD) return ownerProtectedUserFields.has(node.name.value);
    if (node.kind === Kind.INLINE_FRAGMENT) return needsIdentity(node.selectionSet, info, seen);
    if (seen.has(node.name.value)) return false;
    seen.add(node.name.value);
    return needsIdentity(info.fragments[node.name.value]?.selectionSet, info, seen);
  }) ?? false;
}

function isObjectSource(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function resolveUsersWithChildIdentity(
  resolve: (parent: unknown, args: Record<string, unknown>, context: GraphQLContext, info: GraphQLResolveInfo) => unknown,
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
): Promise<unknown> {
  if (!info.fieldNodes.some(node => needsIdentity(node.selectionSet, info))) return resolve(parent, args, context, info);
  // Reserve an alias absent from the entire caller document, including fragments.
  // A caller's `username: bio` must never become the authorization identity.
  const names = new Set<string>();
  const collect = { Field(node: import("graphql").FieldNode) { names.add(node.alias?.value ?? node.name.value); } };
  visit(info.operation, collect);
  for (const fragment of Object.values(info.fragments)) visit(fragment, collect);
  let alias = "_accountIdentity";
  while (names.has(alias)) alias += "_";
  const fieldNodes = info.fieldNodes.map(node => ({ ...node, selectionSet: {
    kind: Kind.SELECTION_SET,
    selections: [...(node.selectionSet?.selections ?? []), {
      kind: Kind.FIELD, name: { kind: Kind.NAME, value: "username" },
      alias: { kind: Kind.NAME, value: alias },
    }],
  } })) satisfies GraphQLResolveInfo["fieldNodes"];
  const result: unknown = await resolve(parent, args, context, { ...info, fieldNodes });
  // Do not decode child values eagerly: GraphQL still owns requested-field
  // completion, nullable failures, aliases and errors. Record only raw identity.
  if (Array.isArray(result)) {
    const rows: readonly unknown[] = result;
    for (const row of rows) {
      if (isObjectSource(row)) {
        rememberAccountChildIdentity(row, alias in row ? row[alias] : undefined);
      }
    }
  }
  return result;
}
export default { Query: { users: resolveUsersWithChildIdentity } };
