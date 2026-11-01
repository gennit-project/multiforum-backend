import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allResolverFields, resolverFields } from "./resolverContractInventory.js";
import { votingMutationNames } from "../customResolvers/contracts/voting.js";

test("every custom composition field has an explicit migration status; pilot status cannot drift", () => {
  const inventory = JSON.parse(readFileSync("docs/resolver-contract-inventory.json", "utf8")) as { formatVersion: number; fields: { field: string; status: string }[] };
  assert.equal(inventory.formatVersion, 1);
  const actual = allResolverFields();
  assert.equal(new Set(actual).size, actual.length, "duplicate composition keys are not permitted");
  assert.deepEqual(inventory.fields.map((r) => r.field), actual, "Update the reviewed inventory when composition changes");
  const selected = votingMutationNames.map((name) => `Mutation.${name}`).sort();
  assert.deepEqual(resolverFields("customResolvers/mutationResolvers.ts", "Mutation", "votingResolvers"), selected, "Every selected pilot must remain inside the checked composition map");
  assert.deepEqual(inventory.fields.filter((r) => r.status === "selected-response").map((r) => r.field), selected);
  assert.ok(inventory.fields.every((r) => ["deferred", "selected-response"].includes(r.status)));
  assert.match(readFileSync("customResolvers/mutationResolvers.ts", "utf8"), /satisfies VotingMutationResolvers/);
});

test("inventory matches the actual composition root, including type fields and scalars", async () => {
  const { default: neo4j } = await import("neo4j-driver");
  const { GraphQLScalarType, Kind } = await import("graphql");
  const { default: typeDefs } = await import("../typeDefs.js");
  const scalarNames = new Set(typeDefs.definitions.flatMap((definition) => definition.kind === Kind.SCALAR_TYPE_DEFINITION ? [definition.name.value] : []));
  const { default: compose } = await import("../customResolvers.js");
  const driver = neo4j.driver("bolt://127.0.0.1:1", neo4j.auth.basic("inventory", "unused"));
  driver.session = () => { throw new Error("Inventory must not access a database"); };
  try {
    const actual = Object.entries(compose(driver).resolvers).flatMap(([name, value]) =>
      value instanceof GraphQLScalarType || scalarNames.has(name) ? [name] : Object.keys(value).map((field) => `${name}.${field}`)).sort();
    assert.deepEqual(allResolverFields(), actual);
  } finally { await driver.close(); }
});
