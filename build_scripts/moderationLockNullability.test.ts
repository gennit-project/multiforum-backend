import assert from "node:assert/strict";
import { test } from "node:test";
import { Kind, type FieldDefinitionNode } from "graphql";
import typeDefs from "../typeDefs.js";

// Generated DateTime maps to any, which cannot express nullability drift. The
// nullable-source adapter must also remain tied to the executable schema input.
test("omitted issue lock metadata remains nullable in the actual schema", () => {
  const issue = typeDefs.definitions.find(definition =>
    definition.kind === Kind.OBJECT_TYPE_DEFINITION && definition.name.value === "Issue");
  assert.ok(issue?.kind === Kind.OBJECT_TYPE_DEFINITION);
  for (const [name, scalar] of [["lockedAt", "DateTime"], ["lockReason", "String"]]) {
    const field: FieldDefinitionNode | undefined = issue.fields?.find(candidate => candidate.name.value === name);
    assert.ok(field, `${name} must exist`);
    assert.equal(field.type.kind, Kind.NAMED_TYPE, `${name} must remain nullable for source omission`);
    assert.ok(field.type.kind === Kind.NAMED_TYPE);
    assert.equal(field.type.name.value, scalar);
  }
});
