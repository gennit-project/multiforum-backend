import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureSchemaConstraints,
  type SchemaConstraintManager,
} from "./schemaConstraints.js";

test("creates missing schema constraints during startup", async () => {
  let receivedOptions: unknown;
  const schema: SchemaConstraintManager = {
    assertIndexesAndConstraints: async (options) => {
      receivedOptions = options;
    },
  };

  await ensureSchemaConstraints(schema);

  assert.deepEqual(receivedOptions, { options: { create: true } });
});
