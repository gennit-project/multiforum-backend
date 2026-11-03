import assert from "node:assert/strict";
import {after,before,beforeEach,test} from "node:test";
import {Neo4jGraphQL} from "@neo4j/graphql";
import {graphql,type GraphQLSchema} from "graphql";
import {applyMiddleware} from "graphql-middleware";
import type {Driver} from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import compose from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import urlDelete from "../../customResolvers/mutations/permanentlyDeleteUrlBackedImage.js";
import imageDelete from "../../customResolvers/mutations/permanentlyDeleteStoredUpload.js";
import {registerGeneratedSchema} from "../../services/persistence/generatedSchemaOperations.js";
import {startNeo4j,stopNeo4j,resetDatabase} from "./neo4jHarness.js";
let driver:Driver,schema:GraphQLSchema,secured:GraphQLSchema;
let deletes=0,fail=false,race=false;
before(async()=>{
 driver=await startNeo4j();const app=compose(driver);
 const deleteObject=async()=>{deletes++;if(fail)throw new Error('storage unavailable');if(race)await driver.executeQuery("MATCH(u:User {username:'alice'}),(c:Channel {uniqueName:'forum'}) SET u.profilePicURL='changed',c.channelIconURL='changed',c.channelBannerURL='changed'");return {status:'deleted' as const};};
 schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,Mutation:{...app.resolvers.Mutation,
  permanentlyDeleteProfileImage:urlDelete({driver,referenceType:'ProfileImage',deleteObject}),
  permanentlyDeleteChannelIcon:urlDelete({driver,referenceType:'ChannelIcon',deleteObject}),
  permanentlyDeleteChannelBanner:urlDelete({driver,referenceType:'ChannelBanner',deleteObject}),
  permanentlyDeleteImage:imageDelete({driver,mediaType:'Image',deleteObject}),
 }}}).getSchema();registerGeneratedSchema(driver,schema);secured=applyMiddleware(schema,permissions);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);deletes=0;fail=false;race=false;await driver.executeQuery(`CREATE(u:User {username:'alice',profilePicURL:'url'}),(b:User {username:'bob',commentKarma:0}),
 (ch:Channel {uniqueName:'forum',channelIconURL:'url',channelBannerURL:'url'}),
 (:UploadedFileAudit {storageUrl:'url',storageBucket:'bucket',storageObjectName:'uploads/alice/image'}),
 (i:Image {id:'image',url:'url',uploadedByUsername:'alice',storageBucket:'bucket',storageObjectName:'uploads/alice/image'}),
 (dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum',createdAt:datetime()}),
 (c:Comment {id:'comment',text:'text',isRootComment:true,createdAt:datetime(),weightedVotesCount:0})
 CREATE(u)-[:ADMIN_OF_CHANNEL]->(ch),(u)-[:UPLOADED_IMAGE]->(i),(b)-[:AUTHORED_COMMENT]->(c),(dc)-[:CONTAINS_COMMENT]->(c),(u)-[:UPVOTED_COMMENT]->(c)`);});
const exec=(source:string,secure=false)=>graphql({schema:secure?secured:schema,source,contextValue:{driver,req:{headers:{}},...(!secure?{user:{username:'alice',email:null,email_verified:true,data:null}}:{})}});
const data=(r:Awaited<ReturnType<typeof exec>>)=>{assert.equal(r.errors,undefined);return JSON.parse(JSON.stringify(r.data));};
for(const [name,args,identity,url] of [
 ['permanentlyDeleteProfileImage','username:"alice",imageUrl:"url"','username','profilePicURL'],
 ['permanentlyDeleteChannelIcon','channelUniqueName:"forum",imageUrl:"url"','uniqueName','channelIconURL'],
 ['permanentlyDeleteChannelBanner','channelUniqueName:"forum",imageUrl:"url"','uniqueName','channelBannerURL'],
] as const){
 const mutation=`mutation{result:${name}(${args}){${identity} ${url}}}`;
 test(`${name}: actual MATCH identity and cleared URL serialize after one deletion`,async()=>{assert.deepEqual(data(await exec(mutation)),{result:{[identity]:identity==='username'?'alice':'forum',[url]:null}});assert.equal(deletes,1);});
 test(`${name}: external failure and reference race preserve errors without counterfeit success`,async()=>{fail=true;assert.match((await exec(mutation)).errors?.[0].message??'',/storage unavailable/);fail=false;race=true;assert.match((await exec(mutation)).errors?.[0].message??'',/Image reference changed/);});
 test(`${name}: anonymous middleware denial happens before external deletion`,async()=>{assert.ok((await exec(mutation,true)).errors);assert.equal(deletes,0);});
}
test('permanentlyDeleteImage shares proven removal fields and rejects a second deletion',async()=>{
 const query='mutation{permanentlyDeleteImage(imageId:"image"){id permanentlyRemoved permanentlyRemovedAt permanentlyRemovedByUsername permanentlyRemovedByModName}}';
 const row=data(await exec(query)).permanentlyDeleteImage;assert.equal(row.id,'image');assert.equal(row.permanentlyRemoved,true);assert.equal(row.permanentlyRemovedByUsername,'alice');assert.equal(row.permanentlyRemovedByModName,null);assert.ok(row.permanentlyRemovedAt);
 assert.ok((await exec(query)).errors);assert.equal(deletes,1);
});
test('scratchpad generated scalar/identity fields preserve vote and karma writes',async()=>{
 const query='mutation{createScratchpadEntry(recipientUsername:"bob",text:" thank you ",sourceType:"comment",sourceId:"comment"){id createdAt text isPublic sourceType sourceId Author{username} Recipient{username}}}';
 const row=data(await exec(query)).createScratchpadEntry;assert.ok(row.id);assert.ok(row.createdAt);assert.equal(row.text,'thank you');assert.equal(row.isPublic,false);assert.equal(row.sourceType,'comment');assert.equal(row.sourceId,'comment');assert.deepEqual(row.Author,{username:'alice'});assert.deepEqual(row.Recipient,{username:'bob'});
 const counts=(await driver.executeQuery('MATCH(c:Comment),(u:User {username:"bob"}) RETURN c.weightedVotesCount AS weight,u.commentKarma AS karma')).records[0];assert.equal(Number(counts.get('weight')),1);assert.equal(Number(counts.get('karma')),1);assert.ok((await exec(query)).errors);
});
test('flair identity is safe while malformed stored Boolean remains lazy',async()=>{
 await driver.executeQuery("MATCH(c:Channel) SET c.discussionFlairRequired='bad' CREATE(c)-[:HAS_DISCUSSION_FLAIR]->(:DiscussionFlair {id:'flair',displayName:'Name',order:1,archived:false})");
 assert.deepEqual(data(await exec('{getChannelDiscussionFlairConfig(channelUniqueName:"forum"){channelUniqueName flairs{channelUniqueName}}}')),{getChannelDiscussionFlairConfig:{channelUniqueName:'forum',flairs:[{channelUniqueName:'forum'}]}});
 assert.ok((await exec('{getChannelDiscussionFlairConfig(channelUniqueName:"forum"){flairRequired}}')).errors);
 const result=data(await exec('mutation{setChannelDiscussionFlairConfig(channelUniqueName:"forum",flairRequired:false,flairs:[]){channelUniqueName flairs{channelUniqueName}}}'));assert.equal(result.setChannelDiscussionFlairConfig.channelUniqueName,'forum');
});
