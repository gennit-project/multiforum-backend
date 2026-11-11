import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import permissions from '../../permissions.js';
import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {wikiListItemSelection} from '../../customResolvers/contracts/wikiListSource.js';
import getWiki from '../../customResolvers/queries/getSiteWideWikiList.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();registerGeneratedSchema(driver,raw);schema=applyMiddleware(raw,sourceIdentity,permissions);},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 await resetDatabase(driver);
 await driver.executeQuery("CREATE(c:Channel {uniqueName:'forum'}),(w:WikiPage {id:'page',title:'Page',body:'Body',slug:'page',createdAt:datetime('2026-01-01T00:00:00Z')}),(u:User {username:'owner',displayName:'Owner',profilePicURL:'pic'}) CREATE(c)-[:OWNS_WIKI_PAGE]->(w),(u)-[:AUTHORED_VERSION]->(w) CREATE(:ServerConfig {featuredWikiPageIds:['page']})");
});
const context=(username:string|null)=>({driver,req:{headers:{}},user:username?{username,email:null,email_verified:true,data:null}:null});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
for(const field of ['wikiPages','featuredWikiPages']){
 test(`${field}: fixed wiki and author maps preserve aliased fragments and date completion`,async()=>{
  const result=await graphql({schema,source:`query($show:Boolean!){result:getSiteWideWikiList{items:${field}{...Page}}} fragment Page on WikiPage{key:id label:title created:createdAt edited:updatedAt author:VersionAuthor @include(if:$show){name:username label:displayName picture:profilePicURL}}`,variableValues:{show:true},contextValue:context(null)});
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  assert.deepEqual(plain(result.data),{result:{items:[{key:'page',label:'Page',created:'2026-01-01T00:00:00.000Z',edited:null,author:{name:'owner',label:'Owner',picture:'pic'}}]}});
 });
 test(`${field}: absent authors stay nullable and unrequested malformed names stay lazy`,async()=>{
  await driver.executeQuery("MATCH(u:User) SET u.username=['bad']");
  const source=`query($show:Boolean!){getSiteWideWikiList{${field}{id VersionAuthor{name:username @include(if:$show)}}}}`;
  const skipped=await graphql({schema,source,variableValues:{show:false},contextValue:context(null)});assert.equal(skipped.errors,undefined);
  const selected=await graphql({schema,source,variableValues:{show:true},contextValue:context(null)});assert.ok(selected.errors?.some(error=>error.path?.includes('name')));
  await driver.executeQuery("MATCH(u:User) DETACH DELETE u");
  const absent=await graphql({schema,source,variableValues:{show:true},contextValue:context(null)});assert.equal(absent.errors,undefined);assert.deepEqual(plain(absent.data),{getSiteWideWikiList:{[field]:[{id:'page',VersionAuthor:null}]}});
 });
}

test('both actual wiki queries emit exactly the fixed source keys',async()=>{
 const result=await getWiki({driver})(null,{});
 for(const items of [result.wikiPages,result.featuredWikiPages]){
  assert.equal(items.length,1);
  assert.deepEqual(Object.keys(items[0]).sort(),Object.keys(wikiListItemSelection).sort());
  assert.ok(items[0].VersionAuthor);
  assert.deepEqual(Object.keys(items[0].VersionAuthor).sort(),Object.keys(wikiListItemSelection.VersionAuthor).sort());
 }
});
test('ordinary channel filters and exhausted pages do not change configured featured items',async()=>{
 const filtered=await getWiki({driver})(null,{selectedChannels:['absent']});
 assert.deepEqual(filtered.wikiPages,[]);assert.equal(filtered.featuredWikiPages.length,1);
 const exhausted=await getWiki({driver})(null,{options:{offset:1}});
 assert.deepEqual(exhausted.wikiPages,[]);assert.equal(exhausted.featuredWikiPages.length,1);
 await driver.executeQuery("MATCH(s:ServerConfig) SET s.featuredWikiPageIds=['absent','page','page']");
 const repeated=await getWiki({driver})(null,{});
 assert.deepEqual(repeated.featuredWikiPages.map(item=>item.id),['page','page']);
});
for(const field of ['wikiPages','featuredWikiPages'])test(`${field}: author access remains owner-scoped and does not fetch unselected source data`,async()=>{
 for(const actor of ['owner','outsider',null]){
  const result=await graphql({schema,source:`{getSiteWideWikiList{${field}{VersionAuthor{username:profilePicURL contact:Email{address}}}}}`,contextValue:context(actor)});
  assert.deepEqual(plain(result.data),{getSiteWideWikiList:{[field]:[{VersionAuthor:{username:'pic',contact:null}}]}});
  assert.equal(result.errors?.length??0,actor==='owner'?0:1);
 }
});
for(const field of ['wikiPages','featuredWikiPages'])test(`${field}: aliases colliding with stored wiki keys retain field meaning`,async()=>{
 const result=await graphql({schema,source:`{getSiteWideWikiList{${field}{id:title title:slug body:channelUniqueName}}}`,contextValue:context(null)});
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getSiteWideWikiList:{[field]:[{id:'Page',title:'page',body:'forum'}]}});
});
