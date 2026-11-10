import { userSourcePaths } from "./userSourcePaths.js";
import type { Album, Channel, Comment, DiscussionChannel, ServerConfig, Image, ModerationProfile, WikiPage, TextVersion, LabelChangeHistory, Discussion, Event, EventSeries, Collection } from "../src/generated/graphql.js";
import { Kind, valueFromASTUntyped, visit } from "graphql";
import type { GraphQLResolveInfo, SelectionSetNode, DirectiveNode, FieldNode, SelectionNode } from "graphql";
import { sourceMetadataRecorder, type SourceMetadataRecorder } from "../services/delegatedSourceMetadata.js";
import { resolveCanonicalSourceField } from "./canonicalSourceFields.js";
import { rememberAuthorSourceType } from "../services/authorSourceType.js";
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

function prepareIdentitySelection(nodes: GraphQLResolveInfo["fieldNodes"], info: GraphQLResolveInfo, unionNodes: ReadonlySet<FieldNode> = new Set()) {
  if (!unionNodes.size && !nodes.some(node => needsIdentity(node.selectionSet, info))) return undefined;
  // Reserve an alias absent from the entire caller document, including fragments.
  // A caller's `username: bio` must never become the authorization identity.
  const names = new Set<string>();
  const collect = { Field(node: import("graphql").FieldNode) { names.add(node.alias?.value ?? node.name.value); } };
  visit(info.operation, collect);
  for (const fragment of Object.values(info.fragments)) visit(fragment, collect);
  let alias = "_accountIdentity";
  while (names.has(alias)) alias += "_";
  names.add(alias);
  let moderatorAlias = "_moderatorIdentity";
  while (names.has(moderatorAlias)) moderatorAlias += "_";
  const identityField: FieldNode = {
    kind: Kind.FIELD, name: { kind: Kind.NAME, value: "username" },
    alias: { kind: Kind.NAME, value: alias },
  };
  const unionSelections: readonly SelectionNode[] = [{
      kind: Kind.INLINE_FRAGMENT,
      typeCondition: { kind: Kind.NAMED_TYPE, name: { kind: Kind.NAME, value: "User" } },
      selectionSet: { kind: Kind.SELECTION_SET, selections: [identityField] },
    }, {
      kind: Kind.INLINE_FRAGMENT,
      typeCondition: { kind: Kind.NAMED_TYPE, name: { kind: Kind.NAME, value: "ModerationProfile" } },
      selectionSet: { kind: Kind.SELECTION_SET, selections: [{
        kind: Kind.FIELD, name: { kind: Kind.NAME, value: "displayName" },
        alias: { kind: Kind.NAME, value: moderatorAlias },
      }] },
    }];
  const fieldNodes = nodes.map(node => ({ ...node, selectionSet: {
    kind: Kind.SELECTION_SET,
    selections: [...(node.selectionSet?.selections ?? []), ...(unionNodes.has(node) ? unionSelections : [identityField])],
  } })) satisfies GraphQLResolveInfo["fieldNodes"];
  return { fieldNodes, alias, moderatorAlias };
}
function rememberRows(result: unknown, alias: string): void {
  if (Array.isArray(result)) {
    const rows: readonly unknown[] = result;
    for (const row of rows) if (isObjectSource(row)) {
      rememberAccountChildIdentity(row, alias in row ? row[alias] : undefined);
    }
  }
}

export async function resolveUsersWithChildIdentity<Parent, Args extends Record<string, unknown>, Context, Result>(
  resolve: (parent: Parent, args: Args, context: Context, info: GraphQLResolveInfo) => Result | PromiseLike<Result>,
  parent: Parent,
  args: Args,
  context: Context,
  info: GraphQLResolveInfo
): Promise<Result> {
  const selected = prepareIdentitySelection(info.fieldNodes, info);
  if (!selected) return resolve(parent, args, context, info);
  const result = await resolve(parent, args, context, { ...info, fieldNodes: selected.fieldNodes });
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

function rememberPath(value: unknown, path: readonly string[], alias: string, moderatorAlias?: string, capture?: SourceMetadataRecorder, responseKeys: readonly string[] = path, responsePath: readonly (string | number)[] = []): void {
  if (Array.isArray(value)) {
    const values: readonly unknown[] = value;
    values.forEach((item, index) => rememberPath(item, path, alias, moderatorAlias, capture, responseKeys, [...responsePath, index]));
  } else if (isObjectSource(value)) {
    if (path.length) rememberPath(value[path[0]], path.slice(1), alias, moderatorAlias, capture, responseKeys.slice(1), [...responsePath, responseKeys[0]]);
    else if (moderatorAlias) {
      // Presence of a private branch selection determines type, never the
      // truthiness of public names or the caller's response aliases.
      const userBranch = Object.prototype.hasOwnProperty.call(value, alias);
      const moderatorBranch = Object.prototype.hasOwnProperty.call(value, moderatorAlias);
      rememberAuthorSourceType(value, userBranch === moderatorBranch ? null : userBranch ? "User" : "ModerationProfile");
      if (userBranch && !moderatorBranch) rememberAccountChildIdentity(value, value[alias]);
    } else rememberAccountChildIdentity(value, alias in value ? value[alias] : undefined);
    if (!path.length) capture?.(responsePath, value);
  }
}

type UserSourcePath = {
  path: readonly string[];
  sourceKeys?: readonly ("response" | "canonical")[];
  /** Only explicit User | ModerationProfile author union sources. */
  userUnion?: true;
};

/** Each registration names verified source paths, never arbitrary descendants. */
export function userChildIdentityAtPaths(paths: readonly UserSourcePath[]): typeof resolveUsersWithChildIdentity {
  if (!paths.length) throw new Error("At least one User source path is required");
  const registrations = paths.map(({path, sourceKeys = path.map(() => "response"), userUnion}) => {
    if (!path.length) throw new Error("A nested User source path is required");
    if (sourceKeys.length !== path.length) throw new Error("Each source path segment needs a key convention");
    return { path: [...path], sourceKeys: [...sourceKeys], userUnion };
  });
  return async (resolve, parent, args, context, info) => {
    const sources = registrations.flatMap(({path, sourceKeys, userUnion}) =>
      info.fieldNodes.flatMap(node => sourceUserFields(node.selectionSet, info, path))
        .filter(source => userUnion || needsIdentity(source.node.selectionSet, info))
        .map(source => ({...source, userUnion, sourcePath: path.map((field, index) => sourceKeys[index] === "canonical" ? field : source.responsePath[index])}))
    );
    const selected = prepareIdentitySelection(sources.map(source => source.node), info, new Set(sources.filter(source => source.userUnion).map(source => source.node)));
    if (!selected) return resolve(parent, args, context, info);
    const replacements = new Map(sources.map((source, index) => [source.node, selected.fieldNodes[index]]));
    const visitor = { Field(node: import("graphql").FieldNode) { return replacements.get(node); } };
    const fieldNodes = info.fieldNodes.map(node => visit(node, visitor));
    const fragments = Object.fromEntries(Object.entries(info.fragments).map(([name, node]) => [name, visit(node, visitor)]));
    const capture = sourceMetadataRecorder(context, info);
    const result = await resolve(parent, args, context, { ...info, fieldNodes, fragments });
    for (const source of sources) rememberPath(result, source.sourcePath, selected.alias, source.userUnion ? selected.moderatorAlias : undefined, capture, source.responsePath);
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

const channelUserPaths = userSourcePaths<Channel>()([["Admins"], ["Bots"], ["PendingOwnerInvites"], ["PendingModInvites"], ["Moderators", "BotUser"]]);
// Schema-checked recursive edge: every traversed hop remains a Channel source.
const relatedChannelUserPaths = userSourcePaths<Channel>()(channelUserPaths.map(path => ["RelatedChannels", ...path] as const));


const albumUserPaths = userSourcePaths<Album>()([["Owner"], ["Images", "Uploader"], ["Images", "PermanentlyRemovedByUser"]]);

const commentVoterPaths = userSourcePaths<Comment>()([["UpvotedByUsers"], ["SuperUpvotedByUsers"]]);
const discussionVoterPaths = userSourcePaths<DiscussionChannel>()(commentVoterPaths);
const commentVoterFields = new Set<string>(commentVoterPaths.map(([field]) => field));

const serverUserPaths = userSourcePaths<ServerConfig>()([["SuperAdmins"], ["Admins"], ["PendingAdminInvites"], ["PendingModInvites"]]);
const imageUserPaths = userSourcePaths<Image>()([["Uploader"], ["PermanentlyRemovedByUser"]]);
const profileUserPaths = userSourcePaths<ModerationProfile>()([["BotUser"]]);
const wikiUserPaths = userSourcePaths<WikiPage>()([["OriginalAuthor"], ["VersionAuthor"]]);
const textVersionUserPaths = userSourcePaths<TextVersion>()([["Author"]]);
const labelChangeUserPaths = userSourcePaths<LabelChangeHistory>()([["ActorUser"]]);
const discussionUserPaths = userSourcePaths<Discussion>()([["Author"], ["BodyLastEditedBy"]]);
const eventUserPaths = userSourcePaths<Event>()([["Poster"], ["DescriptionLastEditedBy"]]);
const seriesUserPaths = userSourcePaths<EventSeries>()([["Poster"]]);
const collectionUserPaths = userSourcePaths<Collection>()([["CreatedBy"]]);

function rootUserPaths(paths: readonly (readonly string[])[]): typeof resolveUsersWithChildIdentity {
  return userChildIdentityAtPaths(paths.map(path => ({path})));
}
function connectionUserPaths(paths: readonly (readonly string[])[]): typeof resolveUsersWithChildIdentity {
  return userChildIdentityAtPaths(paths.map(path => ({path: ["edges", "node", ...path], sourceKeys: ["canonical", "canonical", ...path.map((): "response" => "response")]})));
}

/** Discover only declared identity paths along explicitly selected Comment reply edges.
 * The document is finite and already GraphQL-validated; unrelated descendants
 * are never traversed. Canonical paths are deduplicated across aliases/fragments.
 */
function selectedCommentPaths(info: GraphQLResolveInfo, prefix: UserSourcePath, kind: "author" | "voter"): UserSourcePath[] {
  const paths = new Map<string, UserSourcePath>();
  function scan(selection: SelectionSetNode | undefined, path: readonly string[], seen: ReadonlySet<string>): void {
    for (const node of selection?.selections ?? []) {
      if (!isIncluded(node.directives, info)) continue;
      if (node.kind === Kind.FIELD) {
        const next = [...path, node.name.value];
        if (kind === "author" ? node.name.value === "CommentAuthor" : commentVoterFields.has(node.name.value)) paths.set(next.join("."), {
          path: next,
          sourceKeys: [...(prefix.sourceKeys ?? prefix.path.map((): "response" => "response")), ...next.slice(prefix.path.length).map((): "response" => "response")],
          ...(kind === "author" ? {userUnion: true} : {}),
        });
        else if (node.name.value === "ParentComment" || node.name.value === "ChildComments") scan(node.selectionSet, next, seen);
      } else if (node.kind === Kind.INLINE_FRAGMENT) scan(node.selectionSet, path, seen);
      else if (!seen.has(node.name.value)) scan(info.fragments[node.name.value]?.selectionSet, path, new Set([...seen, node.name.value]));
    }
  }
  for (const node of info.fieldNodes) {
    if (!prefix.path.length) scan(node.selectionSet, [], new Set());
    else for (const source of sourceUserFields(node.selectionSet, info, prefix.path)) scan(source.node.selectionSet, prefix.path, new Set());
  }
  return [...paths.values()];
}

export function selectedCommentAuthorPaths(info: GraphQLResolveInfo, prefix: UserSourcePath = {path: []}): UserSourcePath[] {
  return selectedCommentPaths(info, prefix, "author");
}

function selectedCommentChildIdentity(prefix: UserSourcePath = {path: []}, otherPaths: readonly UserSourcePath[] = []): typeof resolveUsersWithChildIdentity {
  return (resolve, parent, args, context, info) => {
    const paths = [...otherPaths, ...selectedCommentAuthorPaths(info, prefix), ...selectedCommentPaths(info, prefix, "voter")];
    return paths.length ? userChildIdentityAtPaths(paths)(resolve, parent, args, context, info) : Promise.resolve(resolve(parent, args, context, info));
  };
}

/** Expand only active RelatedChannels edges, not arbitrary child objects.
 * The validated request bounds recursion; canonical paths deduplicate aliases.
 */
function selectedChannelChildIdentity(prefix: UserSourcePath = {path: []}): typeof resolveUsersWithChildIdentity {
  return (resolve, parent, args, context, info) => {
    const channels = new Map<string, readonly string[]>();
    const relatedEdge = relatedChannelUserPaths[0][0];
    function scan(selection: SelectionSetNode | undefined, path: readonly string[], seen: ReadonlySet<string>): void {
      channels.set(path.join("."), path);
      for (const node of selection?.selections ?? []) {
        if (!isIncluded(node.directives, info)) continue;
        if (node.kind === Kind.FIELD) {
          if (node.name.value === relatedEdge) scan(node.selectionSet, [...path, relatedEdge], seen);
        } else if (node.kind === Kind.INLINE_FRAGMENT) scan(node.selectionSet, path, seen);
        else if (!seen.has(node.name.value)) scan(info.fragments[node.name.value]?.selectionSet, path, new Set([...seen, node.name.value]));
      }
    }
    for (const node of info.fieldNodes) {
      if (!prefix.path.length) scan(node.selectionSet, [], new Set());
      else for (const source of sourceUserFields(node.selectionSet, info, prefix.path)) scan(source.node.selectionSet, prefix.path, new Set());
    }
    const paths: UserSourcePath[] = [];
    const prefixKeys = prefix.sourceKeys ?? prefix.path.map((): "response" => "response");
    for (const path of channels.values()) {
      const keys = [...prefixKeys, ...path.slice(prefix.path.length).map((): "response" => "response")];
      paths.push(...channelUserPaths.map(child => ({path: [...path, ...child], sourceKeys: [...keys, ...child.map((): "response" => "response")]})));
      const comments = {path: [...path, "Comments"], sourceKeys: [...keys, "response" as const]};
      paths.push(...selectedCommentAuthorPaths(info, comments), ...selectedCommentPaths(info, comments, "voter"));
    }
    return paths.length ? userChildIdentityAtPaths(paths)(resolve, parent, args, context, info) : Promise.resolve(resolve(parent, args, context, info));
  };
}

/** Explicit Issue author, target-user and activity actor/comment sources. */
export function issueSourceIdentity(prefix: UserSourcePath = {path: []}): typeof resolveUsersWithChildIdentity {
  const keys = prefix.sourceKeys ?? prefix.path.map((): "response" => "response");
  const paths: readonly UserSourcePath[] = [
    {path: ["Author"], userUnion: true}, {path: ["TargetUser"]}, {path: ["TargetProfilePictureUser"]}, {path: ["ActivityFeed", "User"]},
  ];
  return selectedCommentChildIdentity(
    {path: [...prefix.path, "ActivityFeed", "Comment"], sourceKeys: [...keys, "response", "response"]},
    paths.map(({path,userUnion}) => ({path:[...prefix.path,...path],sourceKeys:[...keys,...path.map((): "response"=>"response")],...(userUnion?{userUnion}:{})})),
  );
}

/** Neo4j 7.6's update response assembler examines only direct selections in
 * fieldNodes[0]. Expand the concrete payload's active fragments for that view;
 * GraphQL still completes the caller's original document and error paths.
 */
export const resolveUpdatedCommentsWithChildIdentity: typeof resolveUsersWithChildIdentity = (resolve, parent, args, context, info) => {
  function fields(selection: SelectionSetNode | undefined, seen: ReadonlySet<string>): FieldNode[] {
    return (selection?.selections ?? []).flatMap(node => {
      if (!isIncluded(node.directives, info)) return [];
      if (node.kind === Kind.FIELD) return [node];
      if (node.kind === Kind.INLINE_FRAGMENT) return fields(node.selectionSet, seen);
      if (seen.has(node.name.value)) return [];
      return fields(info.fragments[node.name.value]?.selectionSet, new Set([...seen, node.name.value]));
    });
  }
  const first = info.fieldNodes[0];
  const fieldNodes: GraphQLResolveInfo["fieldNodes"] = first ? [{...first, selectionSet: {kind: Kind.SELECTION_SET, selections: info.fieldNodes.flatMap(node => fields(node.selectionSet, new Set()))}}] : info.fieldNodes;
  return selectedCommentChildIdentity({path: ["comments"]})(resolve, parent, args, context, {...info, fieldNodes});
};

export default {
  // Explicitly marked owned projection maps retain canonical source keys.
  // Unmarked generated objects pass through with their response aliases intact.
  ImageAlbumUsage: resolveCanonicalSourceField,
  DiscussionChannelListItem: resolveCanonicalSourceField,
  SiteWideDiscussionListItem: resolveCanonicalSourceField,
  Comment: resolveCanonicalSourceField,
  ModerationProfile: resolveCanonicalSourceField,
  Event: resolveCanonicalSourceField,
  EventChannel: resolveCanonicalSourceField,
  TextVersion: resolveCanonicalSourceField,
  WikiPage: resolveCanonicalSourceField,
  DayData: resolveCanonicalSourceField,
  Activity: resolveCanonicalSourceField,
  UserContributionData: resolveCanonicalSourceField,
  CommentInfo: resolveCanonicalSourceField,
  DiscussionInfo: resolveCanonicalSourceField,
  DiscussionChannelInfo: resolveCanonicalSourceField,
  EventInfo: resolveCanonicalSourceField,
  EventChannelInfo: resolveCanonicalSourceField,
  WikiEditInfo: resolveCanonicalSourceField,
  WikiPageInfo: resolveCanonicalSourceField,

  CommentChildCommentsConnection: resolveCanonicalSourceField,
  CommentCommentChildCommentsAggregateSelection: resolveCanonicalSourceField,
  CommentUpvotedByUsersConnection: resolveCanonicalSourceField,
  CommentUserUpvotedByUsersAggregateSelection: resolveCanonicalSourceField,
  DiscussionChannelUpvotedByUsersConnection: resolveCanonicalSourceField,
  DiscussionChannelUserUpvotedByUsersAggregateSelection: resolveCanonicalSourceField,
  DiscussionChannelCommentsConnection: resolveCanonicalSourceField,
  DiscussionChannelCommentCommentsAggregateSelection: resolveCanonicalSourceField,
  CountConnection: resolveCanonicalSourceField,
  DiscussionFeedbackCommentsConnection: resolveCanonicalSourceField,
  DiscussionCommentFeedbackCommentsAggregateSelection: resolveCanonicalSourceField,
  Collection: resolveCanonicalSourceField,
  License: resolveCanonicalSourceField,
  FilterOption: resolveCanonicalSourceField,
  FilterGroup: resolveCanonicalSourceField,
  ChannelEventChannelsConnection: resolveCanonicalSourceField,
  ChannelEventChannelEventChannelsAggregateSelection: resolveCanonicalSourceField,
  ChannelDiscussionChannelsConnection: resolveCanonicalSourceField,
  ChannelDiscussionChannelDiscussionChannelsAggregateSelection: resolveCanonicalSourceField,
  Channel: resolveCanonicalSourceField,
  DiscussionFlair: resolveCanonicalSourceField,
  Image: resolveCanonicalSourceField,
  Tag: resolveCanonicalSourceField,
  DownloadableFile: resolveCanonicalSourceField,
  Album: resolveCanonicalSourceField,
  User: resolveCanonicalSourceField,
  Discussion: resolveCanonicalSourceField,
  DiscussionChannel: resolveCanonicalSourceField,
  Query: {
    users: resolveUsersWithChildIdentity,
    usersConnection: resolveUserConnectionWithChildIdentity,
    channels: selectedChannelChildIdentity(),
    channelsConnection: selectedChannelChildIdentity({path: ["edges", "node"], sourceKeys: ["canonical", "canonical"]}),
    serverConfigs: rootUserPaths(serverUserPaths),
    serverConfigsConnection: connectionUserPaths(serverUserPaths),
    images: rootUserPaths(imageUserPaths),
    imagesConnection: connectionUserPaths(imageUserPaths),
    albums: rootUserPaths(albumUserPaths),
    albumsConnection: connectionUserPaths(albumUserPaths),
    moderationProfiles: rootUserPaths(profileUserPaths),
    moderationProfilesConnection: connectionUserPaths(profileUserPaths),
    wikiPages: rootUserPaths(wikiUserPaths),
    wikiPagesConnection: connectionUserPaths(wikiUserPaths),
    textVersions: rootUserPaths(textVersionUserPaths),
    textVersionsConnection: connectionUserPaths(textVersionUserPaths),
    labelChangeHistories: rootUserPaths(labelChangeUserPaths),
    labelChangeHistoriesConnection: connectionUserPaths(labelChangeUserPaths),
    discussions: rootUserPaths(discussionUserPaths),
    discussionsConnection: connectionUserPaths(discussionUserPaths),
    events: rootUserPaths(eventUserPaths),
    eventsConnection: connectionUserPaths(eventUserPaths),
    eventSeries: rootUserPaths(seriesUserPaths),
    eventSeriesConnection: connectionUserPaths(seriesUserPaths),
    discussionChannels: rootUserPaths(discussionVoterPaths),
    discussionChannelsConnection: connectionUserPaths(discussionVoterPaths),
    comments: selectedCommentChildIdentity(),
    commentsConnection: selectedCommentChildIdentity({path: ["edges", "node"], sourceKeys: ["canonical", "canonical"]}),
    issues: issueSourceIdentity(),
    issuesConnection: issueSourceIdentity({path:["edges","node"],sourceKeys:["canonical","canonical"]}),
    collections: rootUserPaths(collectionUserPaths),
    collectionsConnection: connectionUserPaths(collectionUserPaths),
  },
  Mutation: {
    updateUsers: resolveUpdatedUsersWithChildIdentity,
    updateComments: resolveUpdatedCommentsWithChildIdentity,
  },
};

/**
 * Internal domain-owned documents keep their exact fixed selections. Neo4j's
 * to-one union projection appends a literal __resolveType after selected fields.
 * Only explicitly registered author paths consume that generated metadata;
 * arbitrary parents and public aliases never become fallback discriminators.
 */
export function generatedAuthorTypesAtPaths(paths: readonly UserSourcePath[]): typeof resolveUsersWithChildIdentity {
  const registrations = paths.map(({path, sourceKeys = path.map(() => 'response')}) => {
    if (!path.length || sourceKeys.length !== path.length) throw new Error('Invalid generated author source path');
    return {path: [...path], sourceKeys: [...sourceKeys]};
  });
  function remember(value: unknown, path: readonly string[]): void {
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      for (const item of items) remember(item, path);
    } else if (isObjectSource(value)) {
      if (path.length) remember(value[path[0]], path.slice(1));
      else if (Object.prototype.hasOwnProperty.call(value, '__resolveType')) {
        const type = value.__resolveType;
        rememberAuthorSourceType(value, type === 'User' || type === 'ModerationProfile' ? type : null);
      }
    }
  }
  return async (resolve, parent, args, context, info) => {
    const result = await resolve(parent, args, context, info);
    for (const {path, sourceKeys} of registrations) {
      for (const node of info.fieldNodes) for (const source of sourceUserFields(node.selectionSet, info, path)) {
        remember(result, path.map((field, index) => sourceKeys[index] === 'canonical' ? field : source.responsePath[index]));
      }
    }
    return result;
  };
}
