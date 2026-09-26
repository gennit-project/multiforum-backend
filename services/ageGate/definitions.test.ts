import assert from "node:assert/strict";
import test from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { isInputObjectType, parse } from "graphql";
import typeDefinitions from "../../typeDefs.js";
import {
  DERIVED_AGE_GATE_TYPES,
  getAgeGateStatements,
} from "./definitions.js";

test("reads an ageGateSensitive statement for every derived type", () => {
  const statements = getAgeGateStatements(typeDefinitions);

  assert.deepEqual(
    DERIVED_AGE_GATE_TYPES.filter((type) =>
      /AS ageGateSensitive$/.test(statements[type])
    ),
    [...DERIVED_AGE_GATE_TYPES]
  );
});

test("fails loudly when a derived type has no definition", () => {
  assert.throws(
    () => getAgeGateStatements(parse("type Comment { id: ID! }")),
    /No ageGateSensitive @cypher statement found for: DiscussionChannel/
  );
});

// The stored flag decides what restricted viewers can see, so no API client
// may ever set it: it must be absent from every generated mutation input.
test("ageGateCleared is not settable through any mutation input", async () => {
  const schema = await new Neo4jGraphQL({ typeDefs: typeDefinitions }).getSchema();
  const settableIn = Object.values(schema.getTypeMap())
    .filter(isInputObjectType)
    .filter((type) => /(Create|Update)Input$/.test(type.name))
    .filter((type) => "ageGateCleared" in type.getFields())
    .map((type) => type.name);

  assert.deepEqual(settableIn, []);
});
