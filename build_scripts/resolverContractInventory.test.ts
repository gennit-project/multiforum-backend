import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allResolverFields, resolverFields, resolverContractType } from "./resolverContractInventory.js";
import { checkedRootGroups, checkedTypeFieldGroups, checkedTypeFieldNames, checkedResolverFields } from "../customResolvers/contracts/registry.js";

test("every custom field has an explicit status and every selected boundary checks its actual registration", () => {
  const inventory = JSON.parse(readFileSync("docs/resolver-contract-inventory.json", "utf8")) as { formatVersion: number; fields: { field: string; status: string }[] };
  assert.equal(inventory.formatVersion, 1);
  const actual = allResolverFields();
  assert.equal(new Set(actual).size, actual.length, "duplicate composition keys are not permitted");
  assert.deepEqual(inventory.fields.map(row => row.field), actual);
  for (const [prefix, variable, typeName, names] of checkedRootGroups) {
    const file = `customResolvers/${prefix === "Mutation" ? "mutation" : "query"}Resolvers.ts`;
    assert.deepEqual(resolverFields(file, prefix, variable), names.map(name => `${prefix}.${name}`).sort());
    assert.equal(resolverContractType(file, variable), typeName);
  }
  for (const [, variable] of checkedTypeFieldGroups) assert.ok(resolverContractType("customResolvers/typeResolvers.ts", variable));
  assert.deepEqual(checkedTypeFieldGroups.flatMap(([prefix, variable]) => resolverFields("customResolvers/typeResolvers.ts", prefix, variable)).sort(), [...checkedTypeFieldNames].sort());
  assert.equal(new Set(checkedResolverFields).size, checkedResolverFields.length);
  assert.deepEqual(inventory.fields.filter(row => row.status === "selected-response").map(row => row.field), checkedResolverFields);
  assert.ok(inventory.fields.every(row => ["deferred", "selected-response"].includes(row.status)));
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
