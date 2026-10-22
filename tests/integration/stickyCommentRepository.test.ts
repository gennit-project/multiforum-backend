import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import {createStickyCommentRepository} from "../../services/persistence/stickyCommentRepository.js";
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
  if(key==="id" && this.event){if(!identities.has(value))identities.set(value,`<id-${identities.size}>`);return identities.get(value);}
  return ["timestamp","createdAt","updatedAt","ageGateTouchedAt"].includes(key)?"<time>":value;
 }));
};
const selected="{ id isRootComment isFeedbackComment deleted archived isSticky }";
const returned="{ comments { id isSticky stickyAt stickyByUsername } }";
const seed=async(restricted=false)=>driver.executeQuery("CREATE(:Comment {id:'target',isRootComment:true,isFeedbackComment:false,isSticky:false,ageGateRestricted:$restricted})",{restricted});
const snapshot=async()=>({events:normalize(events),rows:(await driver.executeQuery("MATCH(n:Comment) RETURN n.isSticky AS sticky,toString(n.stickyAt) AS at,n.stickyByUsername AS username,n.updatedAt IS NOT NULL AS updated,n.ageGateTouchedAt IS NOT NULL AS touched")).records.map(r=>r.toObject())});
const oldRead=async()=>ogm.model("Comment").find({where:{id:"target"},selectionSet:selected});
const oldWrite=async(update:Record<string,unknown>)=>(await ogm.model("Comment").update({where:{id:"target"},update,selectionSet:returned})).comments;
const repo=()=>createStickyCommentRepository(driver);
test("read and write missing target preserve empty arrays",async()=>{
 assert.deepEqual(await repo().findState("target"),await oldRead());
 assert.deepEqual(await repo().updateMetadata("target",{isSticky:true}),await oldWrite({isSticky:true}));assert.deepEqual(events,[]);
});
test("exact read projection retains anonymous age filter and malformed flags",async()=>{
 await seed();assert.deepEqual(await repo().findState("target"),await oldRead());
 await driver.executeQuery("MATCH(n:Comment) SET n.archived=1");await assert.rejects(repo().findState("target"),/Boolean cannot represent a non boolean value/);
 await resetDatabase(driver);await seed(true);assert.deepEqual(await repo().findState("target"),await oldRead());assert.deepEqual(await repo().findState("target"),[]);
});
test("sticky then unsticky preserves selected response, null removal, timestamps and events",async()=>{
 const updates=[{isSticky:true,stickyAt:"2020-01-01T00:00:00Z",stickyByUsername:"alice"},{isSticky:false,stickyAt:null,stickyByUsername:null}];
 await seed();const expectedResults=[];for(const update of updates)expectedResults.push(await oldWrite(update));const expected=await snapshot();assert.equal(events.length,2);
 await resetDatabase(driver);await seed();events=[];const results=[];for(const update of updates)results.push(await repo().updateMetadata("target",update));assert.deepEqual(results,expectedResults);assert.deepEqual(await snapshot(),expected);
});
test("invalid datetime input preserves coercion error and no writes",async()=>{
 await seed();const update={stickyAt:"invalid"};await assert.rejects(oldWrite(update),/DateTime cannot represent non temporal value/);const expected=await snapshot();await assert.rejects(repo().updateMetadata("target",update),/DateTime cannot represent non temporal value/);assert.deepEqual(await snapshot(),expected);
});
test("malformed returned flag preserves projection failure after committed write",async()=>{
 await seed();await driver.executeQuery("MATCH(n:Comment) SET n.isSticky=1");await assert.rejects(oldWrite({stickyByUsername:"alice"}),/Boolean cannot represent a non boolean value/);const expected=await snapshot();
 await resetDatabase(driver);await seed();await driver.executeQuery("MATCH(n:Comment) SET n.isSticky=1");events=[];await assert.rejects(repo().updateMetadata("target",{stickyByUsername:"alice"}),/Boolean cannot represent a non boolean value/);assert.deepEqual(await snapshot(),expected);
});
