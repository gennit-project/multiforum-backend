import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { GraphQLScalarType } from "graphql";
import type { Driver } from "neo4j-driver";
import { registerGeneratedSchema } from "./generatedSchemaOperations.js";
import { executeCanonicalFixedOperation } from "./canonicalFixedOperation.js";
import { hasCanonicalSourceFields } from "../canonicalSourceFields.js";

function fixture() {
  const driver = {} as Driver;
  const raw = { id: "raw-json", nested: { name: "not-a-schema-object" } };
  let calls = 0;
  let context: unknown;
  const schema = makeExecutableSchema({
    typeDefs: `scalar JSON
      type Child {name:String!} type Item {id:ID! nested:Child raw:JSON fail:String!}
      type Query {items(id:ID):[Item] missing:Item} type Mutation {save:Item}`,
    resolvers: {
      JSON: new GraphQLScalarType({ name:"JSON", serialize:value=>value }),
      Query: { items:(_p,_a,ctx)=>{calls++;context=ctx;return [{id:'item',nested:{name:'child'},raw},null];}, missing:()=>null },
      Mutation: { save:()=>{calls++;return {id:'saved',nested:null,raw};} },
      Item: { fail:()=>{throw new Error('fixture selected failure');} },
    },
  });
  registerGeneratedSchema(driver,schema,'fixture');
  return {driver,raw,calls:()=>calls,context:()=>context};
}
test('fixed document provenance follows completed object/list paths but never JSON scalar children',async()=>{
  const f=fixture();
  const result=await executeCanonicalFixedOperation<{items:Array<{id:string;nested:{name:string};raw:unknown}|null>;missing:null}>(f.driver,'query Read($id:ID){items(id:$id){id nested{name} raw} missing{id}}',{id:'item'},{ } as import('neo4j-driver').ManagedTransaction,{mayAccessSensitiveContent:true});
  assert.ok(hasCanonicalSourceFields(result)); assert.ok(hasCanonicalSourceFields(result.items[0]));
  assert.ok(hasCanonicalSourceFields(result.items[0]?.nested)); assert.equal(result.items[1],null);assert.equal(result.missing,null);
  assert.equal(hasCanonicalSourceFields(f.raw),false);assert.equal(hasCanonicalSourceFields(f.raw.nested),false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{items:[{id:'item',nested:{name:'child'},raw:f.raw},null],missing:null});
  assert.deepEqual(f.context(),{sessionConfig:{database:'fixture'},executionContext:{},jwt:{mayAccessSensitiveContent:true}});
});
test('fixed mutation documents preserve nullable children and completed response',async()=>{
  const f=fixture();const result=await executeCanonicalFixedOperation<{save:{id:string;nested:null}}>(f.driver,'mutation{save{id nested{name}}}',{});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{save:{id:'saved',nested:null}});assert.ok(hasCanonicalSourceFields(result.save));assert.equal(f.calls(),1);
});
test('aliases, conditional selections, fragments and multiple operations reject before writes',async()=>{
  for(const source of [
    'mutation{save{key:id}}','mutation{save{id @skip(if:false)}}',
    'mutation{save{...Fields}} fragment Fields on Item{id}','mutation{save{... on Item{id}}}',
    'mutation One{save{id}} mutation Two{save{id}}','mutation{renamed:save{id}}',
  ]) {
    const f=fixture();await assert.rejects(executeCanonicalFixedOperation(f.driver,source,{}),/Canonical fixed/);assert.equal(f.calls(),0);
  }
});
test('GraphQL still performs variable coercion and selected-field error completion',async()=>{
  const f=fixture();await assert.rejects(executeCanonicalFixedOperation(f.driver,'query($id:ID){items(id:$id){id}}',{id:{bad:true}}),/Variable/);assert.equal(f.calls(),0);
  await assert.rejects(executeCanonicalFixedOperation(f.driver,'{items{id fail}}',{}),/fixture selected failure/);
  assert.equal(hasCanonicalSourceFields(f.raw),false);
});
test('abstract object selections are an explicit unsupported boundary',async()=>{
  const driver={} as Driver;
  registerGeneratedSchema(driver,makeExecutableSchema({typeDefs:'union Choice=A|B type A{id:ID} type B{id:ID} type Query{choice:Choice}',resolvers:{Query:{choice:()=>{throw Error('must not execute');}}}}));
  await assert.rejects(executeCanonicalFixedOperation(driver,'{choice{__typename}}',{}),/concrete object children/);
});

test('duplicate selections merge without changing GraphQL field collection',async()=>{
 const f=fixture();const result=await executeCanonicalFixedOperation<{items:Array<{id:string;nested:{name:string}}|null>}>(f.driver,'{items{id nested{name}} items{id nested{name}}}',{});
 assert.ok(hasCanonicalSourceFields(result.items[0]));assert.ok(hasCanonicalSourceFields(result.items[0]?.nested));assert.equal(f.calls(),1);
});
