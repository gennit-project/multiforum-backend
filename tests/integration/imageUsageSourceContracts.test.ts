import assert from "node:assert/strict";
import {before,after,beforeEach,test} from "node:test";
import {Neo4jGraphQL} from "@neo4j/graphql";
import {graphql,type GraphQLSchema} from "graphql";
import {applyMiddleware} from "graphql-middleware";
import type {Driver} from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import userChildIdentityMiddleware from "../../middleware/userChildIdentityMiddleware.js";
import permissions from "../../permissions.js";
import getResolvers from "../helpers/getTestResolvers.js";
import {startNeo4j,stopNeo4j,resetDatabase} from "./neo4jHarness.js";
let driver:Driver,schema:GraphQLSchema,secured:GraphQLSchema;
before(async()=>{driver=await startNeo4j();schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();secured=applyMiddleware(schema,userChildIdentityMiddleware,permissions);},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);await driver.executeQuery(`CREATE(u:User{username:'alice',createdAt:datetime()}),(img:Image{id:'image',createdAt:datetime()}),(a:Album{id:'album'}),(d:Discussion{id:'discussion',title:'Title',createdAt:datetime()}),(dc:DiscussionChannel{id:'post',channelUniqueName:'forum'}) CREATE(u)-[:UPLOADED_IMAGE]->(img),(u)-[:HAS_ALBUM]->(a),(a)-[:HAS_IMAGE]->(img),(d)-[:HAS_ALBUM]->(a),(u)-[:POSTED_DISCUSSION]->(d),(dc)-[:POSTED_IN_CHANNEL]->(d)`);});
const execute=(source:string,secure=false)=>graphql({schema:secure?secured:schema,source,contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false}});
const query='{usage:getImageAlbumUsage(imageId:"image"){imageId uploaderUsername uploaderOwnedAlbums{id Discussions{id DiscussionChannels{channelUniqueName}}} otherAlbums{id}}}';
test('raw usage groups preserve ownership and canonical channel traversal',async()=>{
 const result=await execute(query);assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{usage:{imageId:'image',uploaderUsername:'alice',uploaderOwnedAlbums:[{id:'album',Discussions:[{id:'discussion',DiscussionChannels:[{channelUniqueName:'forum'}]}]}],otherAlbums:[]}});
 const count=await driver.executeQuery("MATCH(:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(:Discussion{id:'discussion'}) RETURN count(*) AS n");assert.equal(count.records[0].get('n').toNumber(),1);
});
test('raw nested titles are only completed when requested through an alias or fragment',async()=>{
 await driver.executeQuery("MATCH(d:Discussion) SET d.title=['malformed']");
 const unselected=await execute(query);assert.equal(unselected.errors,undefined);
 const selected=await execute('query {usage:getImageAlbumUsage(imageId:"image"){uploaderOwnedAlbums{Discussions{...Title}}}} fragment Title on Discussion{bad:title}');
 assert.ok(selected.errors?.some(e=>JSON.stringify(e.path)===JSON.stringify(['usage','uploaderOwnedAlbums',0,'Discussions',0,'bad'])));
});
test('missing and removed images keep the existing explicit error',async()=>{
 await driver.executeQuery("MATCH(img:Image) SET img.permanentlyRemoved=true");assert.match((await execute(query)).errors?.[0].message??'',/Image not found/);
 assert.match((await execute(query.replace('"image"','"missing"'))).errors?.[0].message??'',/Image not found/);
});
test('public middleware preserves nonsensitive usage reads and canonical channels',async()=>{
 const result=await execute(query,true);assert.equal(result.errors,undefined,JSON.stringify(result.errors));assert.deepEqual(JSON.parse(JSON.stringify(result.data)).usage.uploaderOwnedAlbums[0].Discussions[0].DiscussionChannels,[{channelUniqueName:'forum'}]);
});

test('sensitive images remain hidden from a resolved ineligible caller',async()=>{
 await driver.executeQuery("MATCH(img:Image) SET img.hasSensitiveContent=true");
 const result=await execute(query,true);assert.match(result.errors?.[0].message??'',/Image not found/);assert.equal(result.data,null);
});
test('canonical usage User fields keep their meaning when aliases collide with stored field names',async()=>{
 await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.displayName='Alice'");
 const result=await execute('{getImageAlbumUsage(imageId:"image"){uploaderOwnedAlbums{Owner{username:displayName displayName:username}}}}',true);
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{getImageAlbumUsage:{uploaderOwnedAlbums:[{Owner:{username:'Alice',displayName:'alice'}}]}});
});
test('canonical usage list fields cannot be replaced by a different prepopulated relationship alias',async()=>{
 const result=await execute('{getImageAlbumUsage(imageId:"image"){uploaderOwnedAlbums{Discussions:Images{id}}}}',true);
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{getImageAlbumUsage:{uploaderOwnedAlbums:[{Discussions:[]}]}});
});
for(const viewer of ['alice','bob',null])test(`canonical usage aliasing retains protected-child permissions for ${viewer??'anonymous'}`,async()=>{
 await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.displayName='Alice'");
 const result=await graphql({schema:secured,source:'{getImageAlbumUsage(imageId:"image"){uploaderOwnedAlbums{Owner{username:displayName mail:Email{address}}}}}',contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false,user:viewer?{username:viewer,email:null,email_verified:true,data:null}:null}});
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{getImageAlbumUsage:{uploaderOwnedAlbums:[{Owner:{username:'Alice',mail:null}}]}});
 if(viewer==='alice')assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 else assert.deepEqual(result.errors?.map(error=>error.path),[['getImageAlbumUsage','uploaderOwnedAlbums',0,'Owner','mail']],JSON.stringify(result));
});
test('canonical and generated source aliases coexist in a single request',async()=>{
 await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.displayName='Alice'");
 const result=await execute('{owned:getImageAlbumUsage(imageId:"image"){uploaderOwnedAlbums{Owner{username:displayName displayName:username}}} generated:users(where:{username:{eq:"alice"}}){username:displayName displayName:username}}',true);
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const value={username:'Alice',displayName:'alice'};
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{owned:{uploaderOwnedAlbums:[{Owner:value}]},generated:[value]});
});
test('canonical source scalar aliases retain lazy validation and schema null bubbling',async()=>{
 await driver.executeQuery("MATCH(d:Discussion) SET d.title=['bad']");
 assert.equal((await execute(query,true)).errors,undefined);
 const result=await execute('query{getImageAlbumUsage(imageId:"image"){uploaderOwnedAlbums{Discussions{...Fields}}}} fragment Fields on Discussion{id:title title:id}',true);
 assert.deepEqual(result.errors?.map(error=>error.path),[['getImageAlbumUsage','uploaderOwnedAlbums',0,'Discussions',0,'id']],JSON.stringify(result));
 assert.equal(result.data,null); // Discussion.title and its ancestor lists are non-null.
});
