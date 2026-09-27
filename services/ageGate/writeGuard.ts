import {
  isInputObjectType,
  isListType,
  isNonNullType,
  type GraphQLInputType,
  type GraphQLSchema,
} from "graphql";

/**
 * Finds mutation inputs that could change a stored `ageGateRestricted` flag in
 * a way the driver-level reconcile step can't see
 * (docs/age-gate-materialization-design.md, "Keeping flags correct").
 *
 * The reconcile step re-evaluates every node stamped (`ageGateTouchedAt`) in
 * the writing transaction. `@neo4j/graphql` stamps created nodes and plain-value
 * updates, but not relationship-only changes. So two kinds of write are unsafe
 * unless a mutation handles them explicitly:
 *
 * 1. Connecting an existing node along a relationship an age-gate definition
 *    follows, where neither end is being created: `connect`/`connectOrCreate`
 *    inside an update input, or anything in a connect input.
 * 2. Writing `hasSensitiveContent` outside the mutations that own it.
 *
 * Connecting while creating is safe: the new node is stamped and the reconcile
 * walk from it reaches whatever it was connected to.
 */

/**
 * Relationship fields whose endpoints an age-gate definition follows. Each is
 * `Type.field` as declared in typeDefs.ts. tests cover that every relationship
 * type a definition uses is guarded, and that no qualifying field is missing.
 */
export const GUARDED_RELATIONSHIP_FIELDS = [
  "DiscussionChannel.Discussion",
  "Discussion.DiscussionChannels",
  "DiscussionChannel.Comments",
  "Comment.DiscussionChannel",
  "Comment.ParentComment",
  "Comment.ChildComments",
  "Comment.GivesFeedbackOnDiscussion",
  "Comment.GivesFeedbackOnComment",
  "Comment.FeedbackComments",
  "Discussion.FeedbackComments",
  "Discussion.PastTitleVersions",
  "Discussion.PastBodyVersions",
  "Comment.PastVersions",
  "Discussion.DownloadableFiles",
  "DownloadableFile.Discussion",
  "DownloadableFile.versions",
  "FileVersion.mainFile",
] as const;

/**
 * Relationship fields that use a dependency relationship type between
 * age-gated types but that no definition follows, with the reason.
 */
export const EXEMPT_RELATIONSHIP_FIELDS: Record<string, string> = {
  "DiscussionChannel.Answers":
    "IS_REPLY_TO from a comment to a DiscussionChannel marks an accepted answer; the Comment definition only follows IS_REPLY_TO between comments.",
};

/** The only mutations allowed to write `hasSensitiveContent`. */
export const SENSITIVITY_WRITE_MUTATIONS = new Set([
  "createDiscussionWithChannelConnections",
  "updateDiscussionWithChannelConnections",
  "updateDiscussions",
  "createImageWithUploader",
  "updateImages",
]);

/**
 * Relationship moves a mutation re-evaluates itself, in the same transaction.
 * updateDiscussionWithChannelConnections stamps the files it attaches.
 */
export const HANDLED_RELATIONSHIP_MOVES: Record<string, ReadonlySet<string>> = {
  updateDiscussionWithChannelConnections: new Set(["Discussion.DownloadableFiles"]),
};

export type UnsafeAgeGateWrite = {
  path: string;
  reason: "relationship-move" | "sensitivity-write";
  field: string;
};

type FindUnsafeAgeGateWritesParams = {
  schema: GraphQLSchema;
  mutationName: string;
  args: Record<string, unknown>;
};

const guarded = new Set<string>(GUARDED_RELATIONSHIP_FIELDS);

// `${Type}UpdateInput` → Type; `${Type}ConnectInput` / `${Type}ConnectOrCreateInput` → Type.
const UPDATE_INPUT = /^(\w+?)UpdateInput$/;
const CONNECT_INPUT = /^(\w+?)(ConnectInput|ConnectOrCreateInput)$/;
// Inputs that write node properties; `where` filters also contain
// hasSensitiveContent but only read it.
const WRITE_INPUT = /(CreateInput|UpdateInput)$/;

const hasEntries = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasEntries)
    : value !== null && value !== undefined && (typeof value !== "object" || Object.keys(value).length > 0);

// A relationship field's update input (object or list of them) that connects.
const connectsExisting = (value: unknown): boolean =>
  (Array.isArray(value) ? value : [value]).some(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      (hasEntries((entry as Record<string, unknown>).connect) ||
        hasEntries((entry as Record<string, unknown>).connectOrCreate))
  );

const unwrap = (type: GraphQLInputType): GraphQLInputType =>
  isNonNullType(type) ? unwrap(type.ofType) : type;

export function findUnsafeAgeGateWrites({
  schema,
  mutationName,
  args,
}: FindUnsafeAgeGateWritesParams): UnsafeAgeGateWrite[] {
  const mutation = schema.getMutationType()?.getFields()[mutationName];
  if (!mutation) return [];

  const handledMoves = HANDLED_RELATIONSHIP_MOVES[mutationName];
  const mayWriteSensitivity = SENSITIVITY_WRITE_MUTATIONS.has(mutationName);
  const found: UnsafeAgeGateWrite[] = [];

  const visit = (type: GraphQLInputType, value: unknown, path: string): void => {
    if (value === null || value === undefined) return;
    const inner = unwrap(type);
    if (isListType(inner)) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(inner.ofType, item, `${path}[${index}]`));
      }
      return;
    }
    if (!isInputObjectType(inner) || typeof value !== "object") return;

    const updateOwner = UPDATE_INPUT.exec(inner.name)?.[1];
    const connectOwner = CONNECT_INPUT.exec(inner.name)?.[1];
    const fields = inner.getFields();

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      const owner = updateOwner ?? connectOwner;
      const field = owner ? `${owner}.${key}` : undefined;

      if (
        key === "hasSensitiveContent" &&
        child !== undefined &&
        WRITE_INPUT.test(inner.name) &&
        !mayWriteSensitivity
      ) {
        found.push({ path: childPath, reason: "sensitivity-write", field: `${inner.name}.${key}` });
      }

      if (field && guarded.has(field) && !handledMoves?.has(field)) {
        const moves = updateOwner ? connectsExisting(child) : hasEntries(child);
        if (moves) found.push({ path: childPath, reason: "relationship-move", field });
      }

      const fieldDefinition = fields[key];
      if (fieldDefinition) visit(fieldDefinition.type, child, childPath);
    }
  };

  for (const argument of mutation.args) {
    visit(argument.type, args[argument.name], `args.${argument.name}`);
  }
  return found;
}

/** Relationship types an age-gate definition statement follows. */
export const relationshipTypesInStatement = (statement: string): string[] =>
  [...statement.matchAll(/\[:([A-Z_|]+)[^\]]*\]/g)].flatMap((match) =>
    (match[1] ?? "").split("|")
  );
