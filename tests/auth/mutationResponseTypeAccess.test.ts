// Regression guard for the "Not Authorised!" response-field leak.
//
// Hand-declared mutation-response wrapper types (e.g.
// CreateCommentsWithOwnedConnectionsResponse { comments: [Comment!]! }) are NOT
// among the Neo4j-generated wrappers that permissions.ts auto-allows, so unless
// they are explicitly granted read access their fields fall through to
// graphql-shield's `deny` fallback. The mutation then SUCCEEDS (the row is
// written) but returning the created rows errors with "Not Authorised!",
// producing a misleading client-side failure. See the createComment case.
//
// This test fails if any object type named `*Response` that is returned by a
// Mutation field is missing from PUBLIC_READ_TYPES.

import test from "node:test";
import assert from "node:assert/strict";
import type { TypeNode } from "graphql";
import typeDefs from "../../typeDefs.js";
import { PUBLIC_READ_TYPES } from "../../permissions.js";

const unwrapTypeName = (node: TypeNode): string =>
  node.kind === "NonNullType" || node.kind === "ListType"
    ? unwrapTypeName(node.type)
    : node.name.value;

const definitions = typeDefs.definitions;

const declaredObjectTypeNames = new Set(
  definitions
    .filter((def) => def.kind === "ObjectTypeDefinition")
    .map((def) => (def as { name: { value: string } }).name.value)
);

const mutationReturnTypeNames = new Set<string>();
for (const def of definitions) {
  if (
    (def.kind === "ObjectTypeDefinition" ||
      def.kind === "ObjectTypeExtension") &&
    def.name.value === "Mutation"
  ) {
    for (const field of def.fields ?? []) {
      mutationReturnTypeNames.add(unwrapTypeName(field.type));
    }
  }
}

const responseWrapperTypes = [...mutationReturnTypeNames].filter(
  (name) => name.endsWith("Response") && declaredObjectTypeNames.has(name)
);

const readableTypes = new Set<string>(PUBLIC_READ_TYPES);

test("the derivation finds the mutation-response wrapper types", () => {
  assert.ok(
    responseWrapperTypes.includes("CreateCommentsWithOwnedConnectionsResponse"),
    `expected to discover CreateCommentsWithOwnedConnectionsResponse among mutation-response wrappers, got: ${responseWrapperTypes.join(", ")}`
  );
});

test("every mutation-response wrapper type is granted read access", () => {
  const missing = responseWrapperTypes.filter((name) => !readableTypes.has(name));
  assert.deepEqual(
    missing,
    [],
    `mutation-response wrapper types missing from PUBLIC_READ_TYPES (their fields will hit the "Not Authorised!" deny fallback): ${missing.join(", ")}`
  );
});
