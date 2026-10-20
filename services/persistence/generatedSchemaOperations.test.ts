import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import type { Driver } from "neo4j-driver";
import { executeGeneratedOperation, registerGeneratedSchema } from "./generatedSchemaOperations.js";

const driver = () => ({} as Driver);
const createSchema = (read: (_source: unknown, args: {value: number}, context: unknown) => unknown) => makeExecutableSchema({
  typeDefs: "type Query { read(value: Int!): Int, fail: Int, later: Int }",
  resolvers: { Query: { read, fail: () => { throw new Error("first error"); }, later: () => { throw new Error("later error"); } } },
});

test("unregistered drivers fail closed, even when another driver is registered", async () => {
  const registered = driver();
  registerGeneratedSchema(registered, createSchema((_s, args) => args.value));
  await assert.rejects(executeGeneratedOperation(driver(), "{ read(value: 1) }", {}), /not initialized for this driver/);
  assert.deepEqual(JSON.parse(JSON.stringify(await executeGeneratedOperation(registered, "{ read(value: 1) }", {}))), { read: 1 });
});

test("internal execution receives only its database context and null root", async () => {
  const instance = driver();
  let observed: unknown;
  let root: unknown;
  registerGeneratedSchema(instance, createSchema((source, args, context) => { root = source; observed = context; return args.value; }), "isolated");
  await executeGeneratedOperation(instance, "query Snapshot($value:Int!){read(value:$value)}", {value: 2, jwt: {sub: "untrusted"}});
  assert.equal(root, null);
  assert.deepEqual(observed, {sessionConfig: {database: "isolated"}});
});

test("unspecified database preserves the current OGM constructor context", async () => {
  const instance = driver();
  let observed: unknown;
  registerGeneratedSchema(instance, createSchema((_s, args, context) => { observed = context; return args.value; }));
  await executeGeneratedOperation(instance, "{ read(value: 1) }", {});
  assert.deepEqual(observed, {sessionConfig: {database: undefined}});
});

test("supported execution parses, validates and coerces variables before resolvers run", async () => {
  const instance = driver();
  let calls = 0;
  registerGeneratedSchema(instance, createSchema((_s, args) => { calls++; return args.value; }));
  await assert.rejects(executeGeneratedOperation(instance, "query {", {}), /Syntax Error/);
  await assert.rejects(executeGeneratedOperation(instance, "{ unknown }", {}), /Cannot query field/);
  await assert.rejects(executeGeneratedOperation(instance, "query Snapshot($value:Int!){read(value:$value)}", {value: "bad"}), /Variable "\$value" got invalid value/);
  assert.equal(calls, 0);
  await executeGeneratedOperation(instance, "query Snapshot($value:Int! = 7){read(value:$value)}", {});
  assert.equal(calls, 1);
});

test("the first GraphQL error is thrown as an ordinary Error without extensions", async () => {
  const instance = driver();
  registerGeneratedSchema(instance, createSchema((_s, args) => args.value));
  await assert.rejects(executeGeneratedOperation(instance, "{fail later}", {}), error => {
    assert.equal((error as Error).constructor, Error);
    assert.equal((error as Error).message, "first error");
    return true;
  });
});
