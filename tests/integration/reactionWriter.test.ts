import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createReactionWriter } from "../../services/persistence/reactionWriter.js";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver:Driver;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ["create","update","create_relationship","delete_relationship","delete"])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{
 driver=await startNeo4j();const app=getCustomResolvers(driver);
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});
 const schema=await neoSchema.getSchema();registerGeneratedSchema(driver,schema);
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
for(const [model,method] of [["Comment","updateCommentEmoji"],["DiscussionChannel","updateDiscussionChannelEmoji"]] as const){
 const seed=async(valid=true,restricted=false)=>{await driver.executeQuery(`CREATE (n:${model} {id:'target', discussionId:'discussion', channelUniqueName:'cats', emoji:'{}', isRootComment:true, isFeedbackComment:false, ageGateRestricted:$restricted}) SET n.createdAt=CASE WHEN $valid THEN datetime('2020-01-01T00:00:00Z') ELSE null END`,{valid,restricted});};
 const newWrite=async(emoji:string)=>createReactionWriter(driver)[method]("target",emoji);
 const snapshot=async()=>({rows:(await driver.executeQuery(`MATCH(n:${model}) RETURN n.emoji AS emoji, n.updatedAt IS NOT NULL AS updated, n.ageGateTouchedAt IS NOT NULL AS touched`)).records.map(r=>r.toObject())});
 test(`${model} missing target is a successful no-op`,async(t)=>{
  await newWrite('{}');t.assert.snapshot(await snapshot());
 });
 test(`${model} repeated equal writes preserve timestamps and native events`,async(t)=>{
  await seed();await newWrite('{"reaction":1}');await newWrite('{"reaction":1}');t.assert.snapshot(await snapshot());
 });
 test(`${model} default scalar projection failure retains committed update and error`,async(t)=>{
  await seed(false);await assert.rejects(newWrite('{}'),/Cannot return null for non-nullable field \w+\.createdAt/);t.assert.snapshot(await snapshot());
 });
 test(`${model} malformed generated input preserves coercion errors and graph effects`,async(t)=>{
  await seed();const invalid={nested:"value"} as unknown as string;
  await assert.rejects(newWrite(invalid),/Property values can only be of primitive types/);t.assert.snapshot(await snapshot());
 });
 test(`${model} internal anonymous authorization behavior retains committed write`,async(t)=>{
  await seed(true,true);await newWrite('{}');t.assert.snapshot(await snapshot());
 });
}
