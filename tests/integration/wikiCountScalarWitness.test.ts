import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, isObjectType, type GraphQLSchema } from "graphql";
import neo4j, { type Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";
let driver: Driver, schema: GraphQLSchema;
before(async()=>{
  driver=await startNeo4j();
  schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers,features:{filters:{String:{MATCHES:true}}}}).getSchema();
  registerGeneratedSchema(driver,schema);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>resetDatabase(driver));
test("wiki raw driver count is completed by the existing numerical child resolver",async()=>{
  await driver.executeQuery("CREATE(:Channel {uniqueName:'forum'})-[:OWNS_WIKI_PAGE]->(:WikiPage {id:'wiki',title:'Page',createdAt:datetime()})");
  const count=await driver.executeQuery("MATCH(w:WikiPage) RETURN count(w) AS totalCount");
  const raw:unknown=count.records[0].get('totalCount');
  assert.ok(neo4j.isInt(raw));assert.equal(typeof raw.valueOf(),'bigint');
  const execute=(fields:string)=>graphql({schema,source:`{result:getSiteWideWikiList {${fields}}}`,contextValue:{driver}});
  const unselected=await execute('wikiPages {title}');
  assert.equal(unselected.errors,undefined);assert.deepEqual(JSON.parse(JSON.stringify(unselected.data)),{result:{wikiPages:[{title:'Page'}]}});
  const selected=await execute('aggregateWikiPageCount');
  assert.equal(selected.errors,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(selected.data)),{result:{aggregateWikiPageCount:1}});
  const direct=await getResolvers(driver).resolvers.Query.getSiteWideWikiList(null,{});
  assert.ok(neo4j.isInt(direct.aggregateWikiPageCount), 'root source remains Integer; child resolver owns numerical completion');
});


test("wiki source adapter requires the exact Int! child field and installed numerical completion",async()=>{
  const output=schema.getType('SiteWideWikiListFormat');assert.ok(isObjectType(output));
  const child=output.getFields().aggregateWikiPageCount;
  assert.equal(String(child.type),'Int!');assert.equal(typeof child.resolve,'function');
  const query=schema.getQueryType();assert.ok(query);
  const root=query.getFields().getSiteWideWikiList;
  const originalRoot=root.resolve;const originalChild=child.resolve;
  const execute=()=>graphql({schema,source:'{result:getSiteWideWikiList{aggregateWikiPageCount}}',contextValue:{driver}});
  try {
    for(const value of [0,7,neo4j.int(0),neo4j.int(7)]){
      root.resolve=()=>({aggregateWikiPageCount:value});
      const result=await execute();assert.equal(result.errors,undefined);
      assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{result:{aggregateWikiPageCount:neo4j.isInt(value)?value.toNumber():value}});
    }
    root.resolve=()=>({aggregateWikiPageCount:neo4j.int(7)});
    child.resolve=undefined; // Isolated test schema only: demonstrate dependency.
    const withoutCompletion=await execute();
    assert.equal(withoutCompletion.errors?.[0].message,'Int cannot represent non-integer value: 7');
    assert.deepEqual(withoutCompletion.errors?.[0].path,['result','aggregateWikiPageCount']);
  } finally {root.resolve=originalRoot;child.resolve=originalChild;}
});

test("wiki numerical completion still enforces GraphQL integer range and integral values",async()=>{
  const query=schema.getQueryType();assert.ok(query);const root=query.getFields().getSiteWideWikiList;
  const original=root.resolve;
  try{
    for(const value of [2.5,neo4j.int(2147483648)]){
      root.resolve=()=>({aggregateWikiPageCount:value});
      const result=await graphql({schema,source:'{result:getSiteWideWikiList{aggregateWikiPageCount}}',contextValue:{driver}});
      assert.ok(result.errors?.length);assert.deepEqual(result.errors[0].path,['result','aggregateWikiPageCount']);
    }
  }finally{root.resolve=original;}
});

test("wiki empty and exhausted pages keep the native zero fallback",async()=>{
 const execute=(options='')=>graphql({schema,source:`{result:getSiteWideWikiList${options}{aggregateWikiPageCount}}`,contextValue:{driver}});
 let result=await execute();assert.equal(result.errors,undefined);assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{result:{aggregateWikiPageCount:0}});
 await driver.executeQuery("CREATE(:Channel {uniqueName:'forum'})-[:OWNS_WIKI_PAGE]->(:WikiPage {id:'wiki',title:'Page'})");
 result=await execute('(options:{offset:1})');assert.equal(result.errors,undefined);assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{result:{aggregateWikiPageCount:0}});
});

test("wiki nullable search preserves the pre-query TypeError",async()=>{
  const result=await graphql({schema,source:'{result:getSiteWideWikiList(searchInput:null){aggregateWikiPageCount}}',contextValue:{driver}});
  assert.equal(result.errors?.[0].message,"Cannot read properties of null (reading 'trim')");
  assert.deepEqual(result.errors?.[0].path,['result']);
});
