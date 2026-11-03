import assert from "node:assert/strict";
import {before,after,beforeEach,test} from "node:test";
import {Neo4jGraphQL} from "@neo4j/graphql";
import {graphql,type GraphQLSchema} from "graphql";
import {applyMiddleware} from "graphql-middleware";
import type {Driver} from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import getResolvers from "../helpers/getTestResolvers.js";
import {startNeo4j,stopNeo4j,resetDatabase} from "./neo4jHarness.js";
let driver:Driver,schema:GraphQLSchema,secured:GraphQLSchema;
before(async()=>{driver=await startNeo4j();schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();secured=applyMiddleware(schema,permissions);},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);await driver.executeQuery(`CREATE(u:User{username:'alice',createdAt:datetime()}),(img:Image{id:'image',createdAt:datetime()}),(a:Album{id:'album'}),(d:Discussion{id:'discussion',title:'Title',createdAt:datetime()}),(dc:DiscussionChannel{id:'post',channelUniqueName:'forum'}) CREATE(u)-[:UPLOADED_IMAGE]->(img),(u)-[:HAS_ALBUM]->(a),(a)-[:HAS_IMAGE]->(img),(d)-[:HAS_ALBUM]->(a),(u)-[:POSTED_DISCUSSION]->(d),(dc)-[:POSTED_IN_CHANNEL]->(d)`);});
const execute=(source:string,secure=false)=>graphql({schema:secure?secured:schema,source,contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false}});
const query='{usage:getImageAlbumUsage(imageId:"image"){imageId uploaderUsername uploaderOwnedAlbums{id Discussions{id DiscussionChannels{channelUniqueName}}} otherAlbums{id}}}';
test('raw usage groups preserve ownership and characterize the still-reversed channel traversal',async()=>{
 const result=await execute(query);assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{usage:{imageId:'image',uploaderUsername:'alice',uploaderOwnedAlbums:[{id:'album',Discussions:[{id:'discussion',DiscussionChannels:[]}]}],otherAlbums:[]}});
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
test('public middleware preserves nonsensitive usage reads and the channel omission',async()=>{
 const result=await execute(query,true);assert.equal(result.errors,undefined,JSON.stringify(result.errors));assert.deepEqual(JSON.parse(JSON.stringify(result.data)).usage.uploaderOwnedAlbums[0].Discussions[0].DiscussionChannels,[]);
});

test('sensitive images remain hidden from a resolved ineligible caller',async()=>{
 await driver.executeQuery("MATCH(img:Image) SET img.hasSensitiveContent=true");
 const result=await execute(query,true);assert.match(result.errors?.[0].message??'',/Image not found/);assert.equal(result.data,null);
});
