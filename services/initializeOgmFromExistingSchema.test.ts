import test from "node:test";
import assert from "node:assert/strict";
import { buildSchema, type GraphQLSchema } from "graphql";
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

test("removes private output fields from reused OGM default selections", () => {
  const schema = buildSchema(`
    type Query { users: [User!]! }
    type User { username: String! }
  `);
  const model = { name: "User", selectionSet: "" };
  const neoSchema = {
    nodes: [{
      name: "User",
      primitiveFields: [{ fieldName: "username" }],
      scalarFields: [],
      enumFields: [],
      temporalFields: [{ fieldName: "dateOfBirth" }],
    }],
  };
  const ogm = {
    models: [model],
    initModel() {
      model.selectionSet = "{ username dateOfBirth }";
    },
  };

  initializeOgmFromExistingSchema(
    ogm as never,
    neoSchema as unknown as Neo4jGraphQL,
    schema
  );

  assert.equal(model.selectionSet, "{ username }");
});
