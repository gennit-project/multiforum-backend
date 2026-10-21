import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import {createScratchpadRepository,SCRATCHPAD_DEFAULT_SELECTION} from "../../services/persistence/scratchpadRepository.js";
import {parse,print} from "graphql";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>["ogm"];
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ["create","update","create_relationship","delete_relationship","delete"])engine.events.on(kind,event=>events.push(event));
before(async()=>{
 driver=await startNeo4j();const app=getCustomResolvers(driver);ogm=app.ogm;
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neoSchema.getSchema();initializeOgmFromExistingSchema(ogm,neoSchema,schema);registerGeneratedSchema(driver,schema);
},{timeout:240_000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{await engine.close();await stopNeo4j();});
const normalize=(value:unknown)=>{
 const identities=new Map<string,string>();
 return JSON.parse(JSON.stringify(value,function(key,value){
  if(["id","id_from","id_to"].includes(key) && this.event){
   const identity=`${key==="id"&&this.event.includes("relationship")?"relationship":"node"}:${value}`;
   if(!identities.has(identity))identities.set(identity,`<id-${identities.size}>`);return identities.get(identity);
  }
  return ["timestamp","createdAt","updatedAt","ageGateTouchedAt"].includes(key)?"<time>":value;
 }));
};
const repo=()=>createScratchpadRepository(driver);
const seed=async()=>driver.executeQuery(`CREATE(a:User{username:'alice',createdAt:datetime()}),(b:User{username:'bob',createdAt:datetime()}),
(c:Comment{id:'comment',isRootComment:true,isFeedbackComment:false,createdAt:datetime()}),(dc:DiscussionChannel{id:'dc',discussionId:'d',channelUniqueName:'cats',createdAt:datetime()}),(d:Discussion{id:'d'}),
(e:ScratchpadEntry{id:'entry',text:'thanks',isPublic:false,sourceType:'comment',sourceId:'comment',createdAt:datetime()}),(n:Notification{id:'notice'})
CREATE(a)-[:WROTE_SCRATCHPAD_ENTRY]->(e),(b)-[:HAS_SCRATCHPAD_ENTRY]->(e),(a)-[:UPVOTED_COMMENT]->(c),(a)-[:SUPER_UPVOTED_COMMENT]->(c),(a)-[:UPVOTED_DISCUSSION]->(dc),(a)-[:SUPER_UPVOTED_DISCUSSION]->(dc),(b)-[:AUTHORED_COMMENT]->(c),(dc)-[:CONTAINS_COMMENT]->(c),(dc)-[:POSTED_IN_CHANNEL]->(d),(b)-[:POSTED_DISCUSSION]->(d),(n)-[:NOTIFICATION_FOR_SCRATCHPAD_ENTRY]->(e)`);
const snapshot=async()=>({events:normalize(events),counts:(await driver.executeQuery("MATCH(n) RETURN labels(n)[0] AS label,count(n) AS count ORDER BY label")).records.map(r=>({label:r.get('label'),count:r.get('count').toNumber()})),relations:(await driver.executeQuery("MATCH()-[r]->() RETURN type(r) AS type,count(r) AS count ORDER BY type")).records.map(r=>({type:r.get('type'),count:r.get('count').toNumber()})),entries:(await driver.executeQuery("MATCH(e:ScratchpadEntry) RETURN e.isPublic AS public,e.text AS text")).records.map(r=>r.toObject())});
test("visibility mutation retains full default projection",()=>assert.equal(print(parse(SCRATCHPAD_DEFAULT_SELECTION)),print(parse((ogm.model("ScratchpadEntry") as unknown as {getSelectionSetOrDefault():string}).getSelectionSetOrDefault()))));
const readCases=[
 ["User","bob","{username displayName}",()=>repo().findRecipient("bob")],
 ["Comment","comment","{id UpvotedByUsers{username} SuperUpvotedByUsers{username} DiscussionChannel{discussionId channelUniqueName} CommentAuthor{... on User{username}}}",()=>repo().findCommentSource("comment")],
 ["DiscussionChannel","dc","{id discussionId channelUniqueName UpvotedByUsers{username} SuperUpvotedByUsers{username} Discussion{Author{username}}}",()=>repo().findDiscussionSource("dc")],
 ["ScratchpadEntry","entry","{id Recipient{username}}",()=>repo().findOwnership("entry")],
 ["ScratchpadEntry","entry","{id isPublic text sourceType sourceId sourceChannelUniqueName discussionId createdAt Recipient{username} Author{username displayName profilePicURL}}",()=>repo().findVisibility("entry")],
] as const;
for(const [model,id,selectionSet,read] of readCases)test(`${model} ${selectionSet} parity for missing and seeded targets`,async()=>{
 const old=()=>ogm.model(model).find({where:model==="User"?{username:id}:{id},selectionSet});assert.deepEqual(await read(),await old());await seed();assert.deepEqual(await read(),await old());
});
test("visibility repeated writes preserve native events and default response errors",async()=>{
 const old=async()=>{await ogm.model("ScratchpadEntry").update({where:{id:"entry"},update:{isPublic:true}});};
 await seed();await old();await old();const expected=await snapshot();assert.equal(events.length,2);
 await resetDatabase(driver);await seed();events=[];await repo().updateVisibility("entry",true);await repo().updateVisibility("entry",true);assert.deepEqual(await snapshot(),expected);
 await driver.executeQuery("MATCH(e:ScratchpadEntry) REMOVE e.text");let message="";await assert.rejects(old(),e=>{message=(e as Error).message;return true;});await assert.rejects(repo().updateVisibility("entry",true),{message});
});
test("delete preserves detach cleanup, votes, notifications and native events",async()=>{
 await seed();await ogm.model("ScratchpadEntry").delete({where:{id:"entry"}});const expected=await snapshot();assert.ok(expected.counts.some(row=>row.label==="Notification"));assert.ok(expected.relations.some(row=>row.type==="SUPER_UPVOTED_COMMENT"));
 await resetDatabase(driver);await seed();events=[];await repo().deleteEntry("entry");assert.deepEqual(await snapshot(),expected);
});

test("source reads preserve User/Moderator union, nested vote limits and age filtering",async()=>{
 await seed();assert.equal((await repo().findCommentSource("comment"))[0].CommentAuthor?.username,"bob");
 await driver.executeQuery("MATCH(u:User)-[r:AUTHORED_COMMENT]->(c:Comment) DELETE r CREATE(:ModerationProfile{displayName:'mod'})-[:AUTHORED_COMMENT]->(c)");
 const oldComment=()=>ogm.model("Comment").find({where:{id:"comment"},selectionSet:readCases[1][2]});
 // The installed anonymous OGM schema resolves this fragment-only union as
 // User and fails its username projection; preserve that existing error.
 let message="";await assert.rejects(oldComment(),error=>{message=(error as Error).message;return true;});await assert.rejects(repo().findCommentSource("comment"),{message});
 await driver.executeQuery("MATCH(:ModerationProfile)-[r:AUTHORED_COMMENT]->(c:Comment),(u:User{username:'bob'}) DELETE r CREATE(u)-[:AUTHORED_COMMENT]->(c)");
 await driver.executeQuery("MATCH(c:Comment) UNWIND range(1,30) AS i CREATE(:User{username:'voter'+toString(i)})-[:UPVOTED_COMMENT]->(c)");
 assert.equal((await repo().findCommentSource("comment"))[0].UpvotedByUsers?.length,25);assert.deepEqual(await repo().findCommentSource("comment"),await oldComment());
 await driver.executeQuery("MATCH(c:Comment) SET c.ageGateRestricted=true");assert.deepEqual(await repo().findCommentSource("comment"),await oldComment());assert.deepEqual(await repo().findCommentSource("comment"),[]);
});
