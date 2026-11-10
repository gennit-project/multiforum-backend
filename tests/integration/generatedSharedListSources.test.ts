import assert from 'node:assert/strict';
import {sharedListSources as sources,type GeneratedListSource} from '../helpers/sharedListSources.js';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,getNamedType,isObjectType,valueFromASTUntyped,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import middleware from '../../middleware/userChildIdentityMiddleware.js';
import permissions from '../../permissions.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();schema=applyMiddleware(raw,middleware,permissions);},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>resetDatabase(driver));
function definition(source:GeneratedListSource){
 const type=schema.getType(source.parent);assert.ok(isObjectType(type));
 const target=getNamedType(type.getFields()[source.field].type);assert.ok(isObjectType(target));
 const key=target.name==='User'?'username':target.name==='ModerationProfile'?'displayName':target.name==='Channel'?'uniqueName':target.name==='Tag'?'text':'id';
 const node=typeDefs.definitions.find(node=>node.kind==='ObjectTypeDefinition'&&node.name.value===source.parent);
 assert.ok(node?.kind==='ObjectTypeDefinition');
 const relation=node.fields?.find(field=>field.name.value===source.field)?.directives?.find(d=>d.name.value==='relationship');assert.ok(relation);
 const relationType=valueFromASTUntyped(relation.arguments!.find(arg=>arg.name.value==='type')!.value);
 const direction=valueFromASTUntyped(relation.arguments!.find(arg=>arg.name.value==='direction')!.value);
 assert.equal(typeof relationType,'string');assert.ok(direction==='IN'||direction==='OUT');
 return {target:target.name,key,relationType,direction};
}
async function seed(source:GeneratedListSource){
 const d=definition(source);
 await driver.executeQuery(`CREATE(root:${source.parent}{${source.key}:'root',createdAt:datetime()})
 WITH root UNWIND ['first','second'] AS value
 CREATE(child:${d.target}{${d.key}:value,bio:'first',createdAt:datetime(),visibility:'PUBLIC'})
 CREATE ${d.direction==='OUT'?`(root)-[:${d.relationType}]->(child)`:`(child)-[:${d.relationType}]->(root)`}
 FOREACH(_ IN CASE WHEN $isUser THEN [1] ELSE [] END|CREATE(:Email{address:value+'@source.test'})-[:HAS_EMAIL]->(child))`,{isUser:d.target==='User'});
 return d;
}
const context=(username:string|null)=>({driver,req:{headers:{}},jwt:username?{sub:username}:undefined,mayAccessSensitiveContent:false,user:username?{username,email:null,email_verified:true,data:null}:null});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
for(const source of sources){
 test(`${source.parent}.${source.field}: generated source preserves independent aliases, filters and limits`,async()=>{
  const d=await seed(source);
  const result=await graphql({schema,source:`query($show:Boolean!){${source.root}(where:{${source.key}:{eq:"root"}}){...Fields}} fragment Fields on ${source.parent}{a:${source.field}(where:{${d.key}:{eq:"first"}}){key:${d.key}} b:${source.field}(sort:[{${d.key}:ASC}],offset:1,limit:1) @include(if:$show){key:${d.key}}}`,variableValues:{show:true},contextValue:context(null)});
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  assert.deepEqual(plain(result.data),{[source.root]:[{a:[{key:'first'}],b:[{key:'second'}]}]});
 });
 test(`${source.parent}.${source.field}: generated source retains empty and skipped lists`,async()=>{
  const d=await seed(source);
  const result=await graphql({schema,source:`{${source.root}(where:{${source.key}:{eq:"root"}}){empty:${source.field}(where:{${d.key}:{eq:"absent"}}){${d.key}} skipped:${source.field} @skip(if:true){${d.key}}}}`,contextValue:context(null)});
  assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data),{[source.root]:[{empty:[]}]});
 });
 test(`${source.parent}.${source.field}: generated source completes only requested persisted fields`,async()=>{
  const d=await seed(source);
  await driver.executeQuery(`MATCH(n:${d.target}{${d.key}:'first'}) SET n.${d.key}=['invalid']`);
  const query=`query($show:Boolean!){${source.root}(where:{${source.key}:{eq:"root"}}){${source.field}{__typename bad:${d.key} @include(if:$show)}}}`;
  const skipped=await graphql({schema,source:query,variableValues:{show:false},contextValue:context(null)});assert.equal(skipped.errors,undefined,JSON.stringify(skipped.errors));
  const selected=await graphql({schema,source:query,variableValues:{show:true},contextValue:context(null)});assert.ok(selected.errors?.some(error=>error.path?.includes('bad')));
 });
}
const userSources=[...sources.filter(s=>['Admins','Bots','PendingModInvites','PendingOwnerInvites','SuperUpvotedByUsers'].includes(s.field)),{parent:'Comment',root:'comments',key:'id',field:'UpvotedByUsers'},{parent:'DiscussionChannel',root:'discussionChannels',key:'id',field:'UpvotedByUsers'}] satisfies GeneratedListSource[];
for(const source of userSources)test(`${source.parent}.${source.field}: generated User source retains protected-child identity`,async()=>{
 await seed(source);
 const result=await graphql({schema,source:`{${source.root}(where:{${source.key}:{eq:"root"}}){${source.field}(sort:[{username:ASC}]){username:bio contact:Email{address}}}}`,contextValue:context('first')});
 assert.deepEqual(plain(result.data),{[source.root]:[{[source.field]:[{username:'first',contact:{address:'first@source.test'}},{username:'first',contact:null}]}]});
 assert.equal(result.errors?.length,1);assert.ok(result.errors?.[0].path?.includes('contact'));
});

const voterSources=userSources.filter(source=>source.parent==='Comment'||source.parent==='DiscussionChannel');
for(const source of voterSources){
 test(`${source.parent}.${source.field}: connection aliases and fragment directives preserve owner checks`,async()=>{
  await seed(source);
  const query=`query($show:Boolean!){records:${source.root}Connection(where:{id:{eq:"root"}}){links:edges{item:node{actors:${source.field}(sort:[{username:ASC}]){...Private}}}}} fragment Private on User{label:username contact:Email @include(if:$show){address}}`;
  for(const actor of ['first','outsider',null]){
   const result=await graphql({schema,source:query,variableValues:{show:true},contextValue:context(actor)});
   const actors=['first','second'].map(label=>({label,contact:actor===label?{address:label+'@source.test'}:null}));
   assert.deepEqual(plain(result.data),{records:{links:[{item:{actors}}]}});
   assert.equal(result.errors?.length,actor==='first'?1:2);
  }
  const skipped=await graphql({schema,source:query,variableValues:{show:false},contextValue:context(null)});
  assert.equal(skipped.errors,undefined);assert.deepEqual(plain(skipped.data),{records:{links:[{item:{actors:[{label:'first'},{label:'second'}]}}]}});
 });
 test(`${source.parent}.${source.field}: omitted username and raw coercible identity cannot change ownership`,async()=>{
  await seed(source);
  const query=`{${source.root}(where:{id:{eq:"root"}}){${source.field}(sort:[{username:ASC}]){contact:Email{address}}}}`;
  const owner=await graphql({schema,source:query,contextValue:context('first')});
  assert.equal(owner.errors?.length,1);assert.deepEqual(plain(owner.data),{[source.root]:[{[source.field]:[{contact:{address:'first@source.test'}},{contact:null}]}]});
  await driver.executeQuery("MATCH(u:User {username:'first'}) SET u.username=17.5");
  const malformed=await graphql({schema,source:query,contextValue:context('17.5')});
  assert.equal(malformed.errors?.length,2);assert.deepEqual(plain(malformed.data),{[source.root]:[{[source.field]:[{contact:null},{contact:null}]}]});
 });
}
for(const field of ['UpvotedByUsers','SuperUpvotedByUsers'] as const)test(`Comment.${field}: selected reply chain retains voter identity`,async()=>{
 await seed({parent:'Comment',root:'comments',key:'id',field});
 await driver.executeQuery("CREATE(:Comment{id:'parent',createdAt:datetime()})");
 // Use the schema's actual reply relationship to avoid relying on naming conventions.
 const d=definition({parent:'Comment',root:'comments',key:'id',field:'ChildComments'});
 await driver.executeQuery(`MATCH(p:Comment{id:'parent'}),(c:Comment{id:'root'}) CREATE ${d.direction==='OUT'?`(p)-[:${d.relationType}]->(c)`:`(c)-[:${d.relationType}]->(p)`}`);
 const result=await graphql({schema,source:`{comments(where:{id:{eq:"parent"}}){replies:ChildComments{actors:${field}(sort:[{username:ASC}]){username:bio contact:Email{address}}}}}`,contextValue:context('first')});
 assert.equal(result.errors?.length,1);assert.deepEqual(plain(result.data),{comments:[{replies:[{actors:[{username:'first',contact:{address:'first@source.test'}},{username:'first',contact:null}]}]}]});
});
