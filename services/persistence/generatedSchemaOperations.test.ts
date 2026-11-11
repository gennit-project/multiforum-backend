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
  const {print, isObjectType} = await import('graphql');
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
  const originalComments = raw.getQueryType()!.getFields().comments.resolve;
  registerGeneratedSchema(instance, raw, 'isolated');
  const result = await executeGeneratedOperation(instance, '{comments{CommentAuthor{__typename}}}', {user:{username:'not-request-context'}});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {comments:[{CommentAuthor:{__typename:'ModerationProfile'}}]});
  assert.equal(getGeneratedSchema(instance), raw);
  assert.equal(raw.getQueryType()!.getFields().comments.resolve, originalComments);
  assert.deepEqual(observed, {sessionConfig:{database:'isolated'}});
  assert.equal(selection, 'comments {\n  CommentAuthor {\n    __typename\n  }\n}');
  const author = raw.getType('ModerationProfile');
  assert.ok(isObjectType(author));
  author.getFields().displayName.resolve = () => {throw new Error('child failure after registration');};
  await assert.rejects(executeGeneratedOperation(instance, '{comments{CommentAuthor{... on ModerationProfile{displayName}}}}', {}), /child failure after registration/);
  raw.getQueryType()!.getFields().comments.resolve = () => {throw new Error('root failure after registration');};
  await assert.rejects(executeGeneratedOperation(instance, '{comments{CommentAuthor{__typename}}}', {}), /root failure after registration/);
});

test('completed concrete alias-free documents derive source keys without certifying scalar objects',async()=>{
 const {GraphQLScalarType}=await import('graphql');const {hasCanonicalSourceFields}=await import('../canonicalSourceFields.js');
 const instance=driver(),raw={nested:{name:'raw JSON'}};
 registerGeneratedSchema(instance,makeExecutableSchema({typeDefs:'scalar JSON type Query{items:[Item]} type Item{id:ID! child:Child raw:JSON} type Child{name:String}',resolvers:{JSON:new GraphQLScalarType({name:'JSON',serialize:value=>value}),Query:{items:()=>[{id:'one',child:{name:'child'},raw},null]}}}));
 const response=await executeGeneratedOperation<{items:Array<{id:string;child:{name:string};raw:unknown}|null>}>(instance,'{items{id child{name} raw}}',{});
 assert.ok(hasCanonicalSourceFields(response));assert.ok(hasCanonicalSourceFields(response.items[0]));assert.ok(hasCanonicalSourceFields(response.items[0]?.child));assert.equal(response.items[1],null);
 assert.equal(hasCanonicalSourceFields(raw),false);assert.equal(hasCanonicalSourceFields(raw.nested),false);
 assert.deepEqual(JSON.parse(JSON.stringify(response)),{items:[{id:'one',child:{name:'child'},raw},null]});
});
test('aliased, fragment and conditional documents retain their original response maps without inferred provenance',async()=>{
 const {hasCanonicalSourceFields}=await import('../canonicalSourceFields.js');const instance=driver();
 registerGeneratedSchema(instance,makeExecutableSchema({typeDefs:'type Query{items:[Item]} type Item{id:ID! title:String!}',resolvers:{Query:{items:()=>[{id:'one',title:'Title'}]}}}));
 for(const [source,variables,expected] of [
  ['{items{id:title title:id}}',{}, {items:[{id:'Title',title:'one'}]}],
  ['{items{...Fields}} fragment Fields on Item{id title}',{}, {items:[{id:'one',title:'Title'}]}],
  ['query($show:Boolean!){items{id title @include(if:$show)}}',{show:false},{items:[{id:'one'}]}],
 ] as const){
  const response=await executeGeneratedOperation<{items:unknown[]}>(instance,source,variables);assert.deepEqual(JSON.parse(JSON.stringify(response)),expected);
  assert.equal(hasCanonicalSourceFields(response),false);assert.equal(hasCanonicalSourceFields(response.items[0]),false);
 }
});
test('abstract child selections keep existing completion and no canonical-map inference',async()=>{
 const {hasCanonicalSourceFields}=await import('../canonicalSourceFields.js');const instance=driver();
 registerGeneratedSchema(instance,makeExecutableSchema({typeDefs:'union Choice=A|B type A{id:ID!} type B{id:ID!} type Query{choice:Choice}',resolvers:{Query:{choice:()=>({__typename:'A',id:'one'})}}}));
 const response=await executeGeneratedOperation<{choice:unknown}>(instance,'{choice{__typename ... on A{id}}}',{});
 assert.deepEqual(JSON.parse(JSON.stringify(response)),{choice:{__typename:'A',id:'one'}});assert.equal(hasCanonicalSourceFields(response),false);assert.equal(hasCanonicalSourceFields(response.choice),false);
});
