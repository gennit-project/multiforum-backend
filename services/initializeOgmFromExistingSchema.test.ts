import test from "node:test";
import assert from "node:assert/strict";
import type { GraphQLSchema } from "graphql";
import type { Neo4jGraphQL } from "@neo4j/graphql";
import { initializeOgmFromExistingSchema } from "./initializeOgmFromExistingSchema.js";

test("hydrates the OGM with an already-built schema instead of rebuilding it", () => {
  const schema = {} as GraphQLSchema;
  const neoSchema = {} as Neo4jGraphQL;
  const initializedModels: string[] = [];

  const ogm = {
    models: [{ name: "User" }, { name: "Channel" }],
    initModel(model: { name: string }) {
      initializedModels.push(model.name);
    },
  } as const;

  initializeOgmFromExistingSchema(ogm as never, neoSchema, schema);

  assert.equal((ogm as { _schema?: GraphQLSchema })._schema, schema);
  assert.equal((ogm as { neoSchema?: Neo4jGraphQL }).neoSchema, neoSchema);
  assert.deepEqual(initializedModels, ["User", "Channel"]);
});
