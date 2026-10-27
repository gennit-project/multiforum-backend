// FAMILY-3 / v7 (campaign #284). Owned tag writes.
//
// v7 dropped `connectOrCreate` from every generated *TagsFieldInput, so the
// create/update inputs can only `connect` an existing Tag or `create` a new one
// (which would duplicate, since Tag has no unique constraint — its only key is
// `text`). The pre-v7 behaviour was create-if-missing. To preserve it we strip
// the Tags field from the generated create/update input and own the edges here,
// MERGE-ing each Tag by text and MERGE-ing the HAS_TAG relationship — exactly
// the pattern createEventSeriesWithChannelConnections already uses.
//
// Because the texts are extracted from whichever shape the client sends
// (`connect`, the pre-v7 `connectOrCreate` kept via a cast, or `create`; as a
// single field object on create or as the generated update-op list), the
// frontend needs no payload change.

export type TagRunner = (
  cypher: string,
  params: Record<string, unknown>
) => Promise<unknown>;

// `text` on a connect's node filter is the v7 shape `{ eq: "..." }`, but the
// frontend's cast-preserved connectOrCreate payload (and `create` nodes) send a
// plain string, so accept both.
type TagText = string | { eq?: string | null } | null | undefined;
type TagNode = { text?: TagText } | null | undefined;
type TagConnectEntry = {
  where?: { node?: TagNode } | null;
  onCreate?: { node?: TagNode } | null;
  node?: TagNode;
};

const readText = (node: TagNode): string | undefined => {
  const text = node?.text;
  if (typeof text === "string") return text;
  if (text && typeof text === "object" && typeof text.eq === "string") return text.eq;
  return undefined;
};

// Collect tag texts from a Tags field, tolerating every shape a client may send:
//   { connect: [{ where: { node: { text } } }] }
//   { connectOrCreate: [{ where: { node: { text } }, onCreate: { node: { text } } }] }
//   { create: [{ node: { text } }] }
//   [ { connect: [...], connectOrCreate: [...], create: [...] } ]   (update-op list)
export function extractTagTexts(tagsField: unknown): string[] {
  const texts = new Set<string>();
  const addFromEntries = (entries: unknown) => {
    const list = Array.isArray(entries) ? entries : entries == null ? [] : [entries];
    for (const entry of list as TagConnectEntry[]) {
      const text =
        readText(entry?.where?.node) ??
        readText(entry?.onCreate?.node) ??
        readText(entry?.node);
      if (typeof text === "string" && text.trim()) texts.add(text);
    }
  };
  const visitFieldObject = (field: unknown) => {
    if (!field || typeof field !== "object") return;
    const object = field as Record<string, unknown>;
    addFromEntries(object.connect);
    addFromEntries(object.connectOrCreate);
    addFromEntries(object.create);
  };
  if (Array.isArray(tagsField)) tagsField.forEach(visitFieldObject);
  else visitFieldObject(tagsField);
  return [...texts];
}

// Remove the Tags field from a create/update input (the edges are owned instead)
// and return the extracted texts. `hadTags` distinguishes "no Tags field sent"
// (leave tags untouched on update) from "Tags field sent, but empty" (clear them).
export function stripTags<T extends Record<string, any>>(
  input: T | null | undefined
): { cleaned: T; tagTexts: string[]; hadTags: boolean } {
  const source = (input ?? {}) as Record<string, any>;
  const hadTags = Object.prototype.hasOwnProperty.call(source, "Tags");
  const { Tags, ...rest } = source;
  return { cleaned: rest as T, tagTexts: extractTagTexts(Tags), hadTags };
}

export type TagTarget =
  | { label: "Discussion" | "Event"; id: string }
  | { label: "Channel"; uniqueName: string };

const matchClause = (target: TagTarget): string =>
  target.label === "Channel"
    ? "MATCH (n:Channel {uniqueName: $key})"
    : `MATCH (n:${target.label} {id: $key})`;

const keyOf = (target: TagTarget): string =>
  target.label === "Channel" ? target.uniqueName : target.id;

/**
 * Own a node's HAS_TAG edges, creating any missing Tag by text.
 * - `replace: false` (default, for create) only adds the given tags.
 * - `replace: true` (for update) also removes HAS_TAG edges to tags not in the
 *   set, so the node's tags end up exactly `tagTexts` (an empty set clears them).
 * A no-op when there is nothing to do (no tags to add and not replacing).
 */
export async function ownTags(
  run: TagRunner,
  target: TagTarget,
  tagTexts: string[],
  options: { replace?: boolean } = {}
): Promise<void> {
  const replace = options.replace ?? false;
  if (tagTexts.length === 0 && !replace) return;
  const cypher = `
    ${matchClause(target)}
    ${replace
      ? `OPTIONAL MATCH (n)-[stale:HAS_TAG]->(old:Tag) WHERE NOT old.text IN $tagTexts DELETE stale
         WITH n`
      : ``}
    FOREACH (t IN $tagTexts |
      MERGE (tag:Tag {text: t})
      MERGE (n)-[:HAS_TAG]->(tag))
  `;
  await run(cypher, { key: keyOf(target), tagTexts });
}
