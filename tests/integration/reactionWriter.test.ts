import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { parse, print } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createReactionWriter, REACTION_COMMENT_SELECTION, REACTION_DISCUSSION_CHANNEL_SELECTION } from "../../services/persistence/reactionWriter.js";
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
for(const [model,selection,method] of [["Comment",REACTION_COMMENT_SELECTION,"updateCommentEmoji"],["DiscussionChannel",REACTION_DISCUSSION_CHANNEL_SELECTION,"updateDiscussionChannelEmoji"]] as const){
 const seed=async(valid=true,restricted=false)=>{await driver.executeQuery(`CREATE (n:${model} {id:'target', discussionId:'discussion', channelUniqueName:'cats', emoji:'{}', isRootComment:true, isFeedbackComment:false, ageGateRestricted:$restricted}) SET n.createdAt=CASE WHEN $valid THEN datetime('2020-01-01T00:00:00Z') ELSE null END`,{valid,restricted});};
 const oldWrite=async(emoji:string)=>{await ogm.model(model).update({where:{id:"target"},update:{emoji}});};
 const newWrite=async(emoji:string)=>createReactionWriter(driver)[method]("target",emoji);
 const snapshot=async()=>({events:normalize(events),rows:(await driver.executeQuery(`MATCH(n:${model}) RETURN n.emoji AS emoji, n.updatedAt IS NOT NULL AS updated, n.ageGateTouchedAt IS NOT NULL AS touched`)).records.map(r=>r.toObject())});
 test(`${model} response projection exactly matches OGM default selection`,()=>{
  assert.equal(print(parse(selection)),print(parse((ogm.model(model) as unknown as {getSelectionSetOrDefault():string}).getSelectionSetOrDefault())));
 });
 test(`${model} missing target is a successful no-op`,async()=>{
  await oldWrite('{}');const expected=await snapshot();events=[];await newWrite('{}');assert.deepEqual(await snapshot(),expected);
 });
 test(`${model} repeated equal writes preserve timestamps and native events`,async()=>{
  await seed();await oldWrite('{"reaction":1}');await oldWrite('{"reaction":1}');const expected=await snapshot();assert.equal(events.length,2);
  await resetDatabase(driver);await seed();events=[];await newWrite('{"reaction":1}');await newWrite('{"reaction":1}');assert.deepEqual(await snapshot(),expected);
 });
 test(`${model} default scalar projection failure retains committed update and error`,async()=>{
  await seed(false);let message="";await assert.rejects(oldWrite('{}'),error=>{message=(error as Error).message;return true;});const expected=await snapshot();
  await resetDatabase(driver);await seed(false);events=[];await assert.rejects(newWrite('{}'),{message});assert.deepEqual(await snapshot(),expected);
 });
 test(`${model} malformed generated input preserves coercion errors and graph effects`,async()=>{
  const capture=async(run:()=>Promise<void>)=>{try{await run();return "ok";}catch(error){return (error as Error).message;}};
  await seed();const invalid={nested:"value"} as unknown as string;
  const expectedResult=await capture(()=>oldWrite(invalid));const expected=await snapshot();
  await resetDatabase(driver);await seed();events=[];
  assert.equal(await capture(()=>newWrite(invalid)),expectedResult);assert.deepEqual(await snapshot(),expected);
 });
 test(`${model} internal anonymous authorization behavior matches OGM`,async()=>{
  await seed(true,true);await oldWrite('{}');const expected=await snapshot();await resetDatabase(driver);await seed(true,true);events=[];await newWrite('{}');assert.deepEqual(await snapshot(),expected);
 });
}
