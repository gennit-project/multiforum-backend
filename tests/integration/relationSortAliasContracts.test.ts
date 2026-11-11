import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import type {Driver} from 'neo4j-driver';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let schema:GraphQLSchema;
before(async()=>{
 driver=await startNeo4j();await resetDatabase(driver);
 schema=await new Neo4jGraphQL({driver,typeDefs:`
  type SortBucket @node { id: ID! Items: [SortItem!]! @relationship(type:"SORT_ITEM",direction:OUT) }
  type SortItem @node {
   id: ID! name: String! @alias(property:"storedName") label: String! rank: Int
   computed: Int @cypher(statement:"RETURN this.rank * 2 AS value",columnName:"value")
  }
 `}).getSchema();
 await driver.executeQuery(`CREATE(b:SortBucket{id:'bucket'}) WITH b
  UNWIND [{id:'c',name:'charlie',rank:2,label:'two'},{id:'a',name:'alpha',rank:1,label:'three'},{id:'n',name:'delta',rank:null,label:'zero'},{id:'b',name:'bravo',rank:2,label:'one'}] AS item
  CREATE(b)-[:SORT_ITEM]->(:SortItem{id:item.id,storedName:item.name,rank:item.rank,label:item.label})`);
},{timeout:240000});
after(async()=>stopNeo4j());
async function read(body:string){
 const response=await graphql({schema,source:`{sortBuckets(where:{id:{eq:"bucket"}}){${body}}}`,contextValue:{}});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 return JSON.parse(JSON.stringify(response.data)).sortBuckets[0];
}
for(const direction of ['ASC','DESC'])test(`relation property sort ${direction} uses original values before response aliases`,async()=>{
 const result=await read(`Items(sort:[{name:${direction}}]){id actualName:name name:label}`);
 const ids=direction==='ASC'?['a','b','c','n']:['n','c','b','a'];
 const names:Record<string,string>={a:'alpha',b:'bravo',c:'charlie',n:'delta'};
 const labels:Record<string,string>={a:'three',b:'one',c:'two',n:'zero'};
 assert.deepEqual(result.Items,ids.map(id=>({id,actualName:names[id],name:labels[id]})));
});
test('relation sort applies filters and pagination before completing aliased fields',async()=>{
 const result=await read('Items(where:{rank:{gte:1}},sort:[{name:ASC}],offset:1,limit:1){id name:label}');
 assert.deepEqual(result,{Items:[{id:'b',name:'one'}]});
});
for(const direction of ['ASC','DESC'])test(`relation multi-key ${direction} ordering preserves null handling and stable secondary keys`,async()=>{
 const result=await read(`Items(sort:[{rank:${direction}},{name:ASC}]){id rank:label}`);
 assert.deepEqual(result.Items.map((item:{id:string})=>item.id),direction==='ASC'?['a','b','c','n']:['n','b','c','a']);
});
test('computed sort retains computed scope while respecting requested response aliases',async()=>{
 const result=await read('Items(sort:[{computed:DESC},{name:ASC}]){id computed:label actual:computed}');
 assert.deepEqual(result,{Items:[{id:'n',computed:'zero',actual:null},{id:'b',computed:'one',actual:4},{id:'c',computed:'two',actual:4},{id:'a',computed:'three',actual:2}]});
});
test('relation sort without selecting its key still orders and paginates by that key',async()=>{
 assert.deepEqual(await read('Items(sort:[{name:ASC}],offset:1,limit:2){id}'),{Items:[{id:'b'},{id:'c'}]});
});
test('independent relation aliases keep their own filters, sort and limits',async()=>{
 assert.deepEqual(await read('first:Items(sort:[{name:ASC}],limit:1){id name:label} last:Items(where:{rank:{gte:1}},sort:[{name:DESC}],limit:1){id name:label}'),{first:[{id:'a',name:'three'}],last:[{id:'c',name:'two'}]});
});

test('nested mutation response sorting preserves the write and alias projection',async()=>{
 const response=await graphql({schema,source:'mutation{updateSortBuckets(where:{id:{eq:"bucket"}},update:{id:{set:"bucket"}}){sortBuckets{Items(sort:[{name:ASC}]){id name:label}}}}',contextValue:{}});
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{updateSortBuckets:{sortBuckets:[{Items:[{id:'a',name:'three'},{id:'b',name:'one'},{id:'c',name:'two'},{id:'n',name:'zero'}]}]}});
 const persisted=await driver.executeQuery("MATCH(b:SortBucket{id:'bucket'})-[:SORT_ITEM]->(i) RETURN count(i) AS count");
 assert.equal(persisted.records[0].get('count').toNumber(),4);
});

test('generated authorization filters run before relation sorting and pagination',async()=>{
 const secured=await new Neo4jGraphQL({driver,typeDefs:`
  type SortBucket @node { id:ID! Items:[SortItem!]! @relationship(type:"SORT_ITEM",direction:OUT) }
  type SortItem @node @authorization(filter:[{operations:[READ],requireAuthentication:false,where:{node:{visible:{eq:true}}}}]) {
   id:ID! name:String! @alias(property:"storedName") label:String! visible:Boolean
  }
 `}).getSchema();
 await driver.executeQuery("MATCH(i:SortItem) SET i.visible=true");
 await driver.executeQuery("MATCH(b:SortBucket{id:'bucket'}) CREATE(b)-[:SORT_ITEM]->(:SortItem{id:'hidden',storedName:'aardvark',label:'hidden',visible:false})");
 try {
  const response=await graphql({schema:secured,source:'{sortBuckets{Items(sort:[{name:ASC}],limit:1){id name:label}}}',contextValue:{}});
  assert.equal(response.errors,undefined,JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{sortBuckets:[{Items:[{id:'a',name:'three'}]}]});
 } finally {await driver.executeQuery("MATCH(i:SortItem{id:'hidden'}) DETACH DELETE i");}
});
