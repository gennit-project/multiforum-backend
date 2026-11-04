import { Kind, valueFromASTUntyped, visit } from "graphql";
import type { GraphQLResolveInfo, SelectionSetNode, DirectiveNode } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import { rememberAccountChildIdentity } from "../services/accountChildIdentity.js";

// Only the explicit generated sources registered below are covered. Other
// User-producing sources are not certified by this adapter.
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

type UserSourcePath = {
  path: readonly string[];
  sourceKeys?: readonly ("response" | "canonical")[];
};

/** Each registration names verified source paths, never arbitrary descendants. */
export function userChildIdentityAtPaths(paths: readonly UserSourcePath[]): typeof resolveUsersWithChildIdentity {
  if (!paths.length) throw new Error("At least one User source path is required");
  const registrations = paths.map(({path, sourceKeys = path.map(() => "response")}) => {
    if (!path.length) throw new Error("A nested User source path is required");
    if (sourceKeys.length !== path.length) throw new Error("Each source path segment needs a key convention");
    return { path: [...path], sourceKeys: [...sourceKeys] };
  });
  return async (resolve, parent, args, context, info) => {
    const sources = registrations.flatMap(({path, sourceKeys}) =>
      info.fieldNodes.flatMap(node => sourceUserFields(node.selectionSet, info, path))
        .filter(source => needsIdentity(source.node.selectionSet, info))
        .map(source => ({...source, sourcePath: path.map((field, index) => sourceKeys[index] === "canonical" ? field : source.responsePath[index])}))
    );
    const selected = prepareIdentitySelection(sources.map(source => source.node), info);
    if (!selected) return resolve(parent, args, context, info);
    const replacements = new Map(sources.map((source, index) => [source.node, selected.fieldNodes[index]]));
    const visitor = { Field(node: import("graphql").FieldNode) { return replacements.get(node); } };
    const fieldNodes = info.fieldNodes.map(node => visit(node, visitor));
    const fragments = Object.fromEntries(Object.entries(info.fragments).map(([name, node]) => [name, visit(node, visitor)]));
    const result: unknown = await resolve(parent, args, context, { ...info, fieldNodes, fragments });
    for (const source of sources) rememberPath(result, source.sourcePath, selected.alias);
    return result;
  };
}

export function userChildIdentityAtPath(path: readonly string[], sourceKeys?: UserSourcePath["sourceKeys"]): typeof resolveUsersWithChildIdentity {
  return userChildIdentityAtPaths([{path, sourceKeys}]);
}

export const resolveUpdatedUsersWithChildIdentity = userChildIdentityAtPath(["users"]);
// Neo4j root connections return canonical edges/node keys even when the caller
// aliases them. Update payloads and ordinary projections use response keys.
export const resolveUserConnectionWithChildIdentity = userChildIdentityAtPath(["edges", "node"], ["canonical", "canonical"]);

const channelUserLists = ["Admins", "Bots", "PendingOwnerInvites", "PendingModInvites"] as const;

const serverUserLists = ["SuperAdmins", "Admins", "PendingAdminInvites", "PendingModInvites"] as const;

export default {
  Query: {
    users: resolveUsersWithChildIdentity,
    usersConnection: resolveUserConnectionWithChildIdentity,
    channels: userChildIdentityAtPaths(channelUserLists.map(field => ({path: [field]}))),
    channelsConnection: userChildIdentityAtPaths(channelUserLists.map(field => ({path: ["edges", "node", field], sourceKeys: ["canonical", "canonical", "response"]}))),
    serverConfigs: userChildIdentityAtPaths(serverUserLists.map(field => ({path: [field]}))),
    serverConfigsConnection: userChildIdentityAtPaths(serverUserLists.map(field => ({path: ["edges", "node", field], sourceKeys: ["canonical", "canonical", "response"]}))),
    images: userChildIdentityAtPaths([{path: ["Uploader"]}, {path: ["PermanentlyRemovedByUser"]}]),
    imagesConnection: userChildIdentityAtPaths(["Uploader", "PermanentlyRemovedByUser"].map(field => ({path: ["edges", "node", field], sourceKeys: ["canonical", "canonical", "response"]}))),
    albums: userChildIdentityAtPath(["Owner"]),
    albumsConnection: userChildIdentityAtPath(["edges", "node", "Owner"], ["canonical", "canonical", "response"]),
    moderationProfiles: userChildIdentityAtPath(["BotUser"]),
    moderationProfilesConnection: userChildIdentityAtPath(["edges", "node", "BotUser"], ["canonical", "canonical", "response"]),
    wikiPages: userChildIdentityAtPaths(["OriginalAuthor", "VersionAuthor"].map(field => ({path: [field]}))),
    wikiPagesConnection: userChildIdentityAtPaths(["OriginalAuthor", "VersionAuthor"].map(field => ({path: ["edges", "node", field], sourceKeys: ["canonical", "canonical", "response"]}))),
    textVersions: userChildIdentityAtPath(["Author"]),
    textVersionsConnection: userChildIdentityAtPath(["edges", "node", "Author"], ["canonical", "canonical", "response"]),
    labelChangeHistories: userChildIdentityAtPath(["ActorUser"]),
    labelChangeHistoriesConnection: userChildIdentityAtPath(["edges", "node", "ActorUser"], ["canonical", "canonical", "response"]),
    discussions: userChildIdentityAtPaths(["Author", "BodyLastEditedBy"].map(field => ({path: [field]}))),
    discussionsConnection: userChildIdentityAtPaths(["Author", "BodyLastEditedBy"].map(field => ({path: ["edges", "node", field], sourceKeys: ["canonical", "canonical", "response"]}))),
    events: userChildIdentityAtPaths(["Poster", "DescriptionLastEditedBy"].map(field => ({path: [field]}))),
    eventsConnection: userChildIdentityAtPaths(["Poster", "DescriptionLastEditedBy"].map(field => ({path: ["edges", "node", field], sourceKeys: ["canonical", "canonical", "response"]}))),
    eventSeries: userChildIdentityAtPath(["Poster"]),
    eventSeriesConnection: userChildIdentityAtPath(["edges", "node", "Poster"], ["canonical", "canonical", "response"]),
    collections: userChildIdentityAtPath(["CreatedBy"]),
    collectionsConnection: userChildIdentityAtPath(["edges", "node", "CreatedBy"], ["canonical", "canonical", "response"]),
  },
  Mutation: { updateUsers: resolveUpdatedUsersWithChildIdentity },
};
