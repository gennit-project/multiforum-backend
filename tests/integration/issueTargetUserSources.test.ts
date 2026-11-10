import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import type { Driver } from 'neo4j-driver';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, type GraphQLSchema } from 'graphql';
import { applyMiddleware } from 'graphql-middleware';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import userChildIdentityMiddleware from '../../middleware/userChildIdentityMiddleware.js';
import getResolvers from '../helpers/getTestResolvers.js';
import { registerGeneratedSchema } from '../../services/persistence/generatedSchemaOperations.js';
import { startNeo4j, stopNeo4j, resetDatabase } from './neo4jHarness.js';
let driver: Driver;
let schema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j(); await resetDatabase(driver);
  const raw = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers }).getSchema();
  registerGeneratedSchema(driver, raw);
  schema = applyMiddleware(raw, userChildIdentityMiddleware, permissions);
  await driver.executeQuery(`CREATE(a:User{username:'alice',bio:'bob',createdAt:datetime()}),
    (b:User{username:'bob',bio:'alice',createdAt:datetime()}),
    (:Email{address:'alice@target.test'})-[:HAS_EMAIL]->(a),
    (:Email{address:'bob@target.test'})-[:HAS_EMAIL]->(b),
    (i:Issue{id:'target',issueNumber:1,isOpen:true,createdAt:datetime()}),
    (:Issue{id:'empty',issueNumber:2,isOpen:true,createdAt:datetime()}),
    (i)-[:TARGETS_USER]->(a),(i)-[:TARGETS_PROFILE_PICTURE_USER]->(b)`);
}, { timeout: 240000 });
after(async () => stopNeo4j());
const context = (viewer: string|null) => ({ driver, req: { headers: {} }, user: viewer ? { username: viewer, email: null, email_verified: true, data: null } : null });
for (const field of ['TargetUser','TargetProfilePictureUser']) test(`${field} supplies owner identity without selecting username`, async () => {
  const viewer = field === 'TargetUser' ? 'alice' : 'bob';
  const response = await graphql({schema, source:`{issues(where:{id:{eq:"target"}}){${field}{Email{address}}}}`,contextValue:context(viewer)});
  assert.equal(response.errors,undefined,JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{issues:[{[field]:{Email:{address:`${viewer}@target.test`}}}]});
});
for(const connection of [false,true]) for(const viewer of ['alice','bob',null]) test(`issue target aliases retain ${connection?'connection':'list'} permissions for ${viewer??'anonymous'}`,async()=>{
  const body='target:TargetUser{...Protected} picture:TargetProfilePictureUser{...Protected}';
  const source=connection?`query($show:Boolean!=true){page:issuesConnection(where:{id:{eq:"target"}}){links:edges{entry:node{${body}}}}}`:`query($show:Boolean!=true){page:issues(where:{id:{eq:"target"}}){${body}}}`;
  const response=await graphql({schema,source:source+' fragment Protected on User{username:bio mail:Email @include(if:$show){address}}',contextValue:context(viewer)});
  const item={target:{username:'bob',mail:viewer==='alice'?{address:'alice@target.test'}:null},picture:{username:'alice',mail:viewer==='bob'?{address:'bob@target.test'}:null}};
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),connection?{page:{links:[{entry:item}]}}:{page:[item]});
  const prefix=connection?['page','links',0,'entry']:['page',0];
  const paths=[...(viewer==='alice'?[]:[[...prefix,'target','mail']]),...(viewer==='bob'?[]:[[...prefix,'picture','mail']])];
  assert.deepEqual(response.errors?.map(error=>JSON.stringify(error.path)).sort(),paths.map(path=>JSON.stringify(path)).sort(),JSON.stringify(response));
});
test('issue target selections preserve defaults, skipped fields, pagination and null targets',async()=>{
  const response=await graphql({schema,source:`query($hide:Boolean!=true){
    page:issues(sort:[{id:ASC}],offset:1,limit:1){id TargetUser{username Email @skip(if:$hide){address}}}
    empty:issues(where:{id:{eq:"empty"}}){TargetUser{Email{address}} TargetProfilePictureUser{Email{address}}}
    missing:issues(where:{id:{eq:"missing"}}){TargetUser{Email{address}}}
    issues @skip(if:$hide){TargetUser{Email{address}}}
  }`,contextValue:context(null)});
  assert.equal(response.errors,undefined,JSON.stringify(response.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{page:[{id:'target',TargetUser:{username:'alice'}}],empty:[{TargetUser:null,TargetProfilePictureUser:null}],missing:[]});
});
test('issue target malformed public scalar remains local while selected owner mail completes',async()=>{
  await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio=['bad']");
  try {
    const response=await graphql({schema,source:'{issues(where:{id:{eq:"target"}}){TargetUser{bio Email{address}}}}',contextValue:context('alice')});
    assert.deepEqual(response.errors?.map(error=>error.path),[['issues',0,'TargetUser','bio']],JSON.stringify(response));
    assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{issues:[{TargetUser:{bio:null,Email:{address:'alice@target.test'}}}]});
  }finally{await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.bio='bob'");}
});
