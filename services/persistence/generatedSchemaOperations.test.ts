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

test("explicit caller-owned transaction is forwarded without inheriting request identity", async () => {
  const instance = driver();
  const transaction = {run: async () => ({records: []})} as unknown as import("neo4j-driver").ManagedTransaction;
  let observed: unknown;
  registerGeneratedSchema(instance, createSchema((_s,args,context)=>{observed=context;return args.value;}), "isolated");
  await executeGeneratedOperation(instance,"{read(value:3)}",{jwt:{sub:"untrusted"}},transaction);
  assert.deepEqual(observed,{sessionConfig:{database:"isolated"},executionContext:transaction});
  assert.equal((observed as {executionContext:unknown}).executionContext,transaction);
});

test('internal author projections retain context and documents without changing the raw schema accessor', async () => {
  const {getGeneratedSchema} = await import('./generatedSchemaOperations.js');
  const {authorSourceType} = await import('../authorSourceType.js');
  const {print} = await import('graphql');
  const instance = driver();
  let observed: unknown;
  let selection = '';
  const raw = makeExecutableSchema({
    typeDefs: 'type Query{comments:[Comment]} type Comment{CommentAuthor:Author} union Author=User|ModerationProfile type User{username:String} type ModerationProfile{displayName:String}',
    resolvers: {
      Query:{comments:(_p,_a,ctx,info)=>{observed=ctx;selection=print(info.fieldNodes[0]);return [{CommentAuthor:{__resolveType:'ModerationProfile',displayName:null,username:'forged'}}];}},
      Author:{__resolveType:(obj:object)=>{const type=authorSourceType(obj);return type.found?type.value:null;}},
    },
  });
  registerGeneratedSchema(instance, raw, 'isolated');
  const result = await executeGeneratedOperation(instance, '{comments{CommentAuthor{__typename}}}', {user:{username:'not-request-context'}});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {comments:[{CommentAuthor:{__typename:'ModerationProfile'}}]});
  assert.equal(getGeneratedSchema(instance), raw);
  assert.deepEqual(observed, {sessionConfig:{database:'isolated'}});
  assert.equal(selection, 'comments {\n  CommentAuthor {\n    __typename\n  }\n}');
});
