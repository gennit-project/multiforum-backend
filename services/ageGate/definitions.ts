import { Kind, type DocumentNode, type StringValueNode } from "graphql";

/**
 * Types whose age-gate result is derived from other nodes (a parent
 * discussion, a reply chain, a related image, ...). Each stores the result in
 * `ageGateRestricted`; see docs/age-gate-materialization-design.md.
 *
 * Discussion and Image are not listed: their result is their own
 * `hasSensitiveContent` property.
 */
export const DERIVED_AGE_GATE_TYPES = [
  "DiscussionChannel",
  "DownloadableFile",
  "FileVersion",
  "Comment",
  "TextVersion",
  "Issue",
] as const;

export type DerivedAgeGateType = (typeof DERIVED_AGE_GATE_TYPES)[number];

/**
 * The `ageGateSensitive` `@cypher` statement for each derived type, read from
 * the schema so the stored flag is always checked against the same definition
 * the API filters on. Each statement references `this` and returns
 * `ageGateSensitive`.
 */
export function getAgeGateStatements(
  typeDefs: DocumentNode
): Record<DerivedAgeGateType, string> {
  const statements: Partial<Record<DerivedAgeGateType, string>> = {};

  for (const definition of typeDefs.definitions) {
    if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION) continue;
    const typeName = definition.name.value as DerivedAgeGateType;
    if (!DERIVED_AGE_GATE_TYPES.includes(typeName)) continue;

    const field = definition.fields?.find(
      (candidate) => candidate.name.value === "ageGateSensitive"
    );
    const statement = field?.directives
      ?.find((directive) => directive.name.value === "cypher")
      ?.arguments?.find((argument) => argument.name.value === "statement");
    if (statement?.value.kind === Kind.STRING) {
      statements[typeName] = (statement.value as StringValueNode).value;
    }
  }

  const missing = DERIVED_AGE_GATE_TYPES.filter((type) => !statements[type]);
  if (missing.length > 0) {
    throw new Error(
      `No ageGateSensitive @cypher statement found for: ${missing.join(", ")}`
    );
  }
  return statements as Record<DerivedAgeGateType, string>;
}
