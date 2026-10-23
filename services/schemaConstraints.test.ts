import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureSchemaConstraints,
  type SchemaConstraintManager,
} from "./schemaConstraints.js";

test("creates missing schema constraints during startup", async () => {
  let called = false;
  const schema: SchemaConstraintManager = {
    assertIndexesAndConstraints: async () => {
      called = true;
    },
  };

  await ensureSchemaConstraints(schema);

  // v7 creates missing indexes/constraints by default (no `create` option).
  assert.equal(called, true);
});
