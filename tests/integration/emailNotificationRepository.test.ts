import assert from "node:assert/strict";
import { before, beforeEach, after, afterEach, test, mock } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import sgMail from "@sendgrid/mail";
import { Resend } from "resend";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createEmailNotificationRepository } from "../../services/persistence/emailNotificationRepository.js";
import { sendEmailToUser } from "../../customResolvers/mutations/shared/emailUtils.js";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver:Driver;
let ogm:ReturnType<typeof getCustomResolvers>["ogm"];
let repository:ReturnType<typeof createEmailNotificationRepository>;
const engine=createSubscriptionEngine();let events:unknown[]=[];let nativeCalls=0;
for(const kind of ["create","update","create_relationship","delete_relationship","delete"])engine.events.on(kind,event=>events.push(event));
before(async()=>{
 mock.method(sgMail,"send",async()=>{nativeCalls++;throw new Error("Native SendGrid forbidden");});
 mock.method(Resend.prototype,"post",async()=>{nativeCalls++;throw new Error("Native Resend forbidden");});
 driver=await startNeo4j();const app=getCustomResolvers(driver);ogm=app.ogm;
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neoSchema.getSchema();initializeOgmFromExistingSchema(ogm,neoSchema,schema);registerGeneratedSchema(driver,schema);
 repository=createEmailNotificationRepository(driver);
},{timeout:240_000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
afterEach(()=>assert.equal(nativeCalls,0));
after(async()=>{mock.restoreAll();await engine.close();await stopNeo4j();});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const oldWrite=async()=>Boolean((await ogm.model("User").update({where:{username:"alice"},update:{Notifications:[{create:[{node:{text:"Notice",read:false}}]}]}})).users[0]);
const normalize=(value:unknown):unknown=>{
 const identities=new Map<string,string>();
 return JSON.parse(JSON.stringify(value,function(key,value){
  if(["id","id_from","id_to"].includes(key)){
   const identity=`${key==="id"&&this.event?.includes("relationship")?"relationship":"node"}:${value}`;
   if(!identities.has(identity))identities.set(identity,`<id-${identities.size}>`);
   return identities.get(identity);
  }
  return["timestamp","createdAt","updatedAt"].includes(key)?"<generated-time>":value;
 }));
};
const rows=async()=>plain((await driver.executeQuery("MATCH (:User)-[:HAS_NOTIFICATION]->(n:Notification) RETURN n.text AS text,n.read AS read,n.notificationType AS type ORDER BY text")).records.map(r=>r.toObject()));
const seed=async(valid=true)=>driver.executeQuery(valid?"CREATE (u:User {username:'alice',createdAt:datetime()}) CREATE (:Email {address:'alice@example.test'})-[:HAS_EMAIL]->(u)":"CREATE (:User {username:'alice'})");

test("recipient read retains missing user/email and exact selected projection",async()=>{
 for(const phase of["missing","no-email","email"]){
  if(phase==="no-email")await driver.executeQuery("CREATE (:User {username:'alice'})");
  if(phase==="email")await driver.executeQuery("MATCH (u:User {username:'alice'}) CREATE (:Email {address:'alice@example.test'})-[:HAS_EMAIL]->(u)");
  assert.deepEqual(plain(await repository.findRecipient("alice")),plain(await ogm.model("User").find({where:{username:"alice"},selectionSet:"{username Email {address}}"})));
 }
});
test("notification writes omit type and retain duplicates and native events",async()=>{
 await seed();assert.equal(await oldWrite(),true);assert.equal(await oldWrite(),true);
 const expected={rows:await rows(),events:normalize(events)};
 assert.deepEqual(expected.rows,[{text:"Notice",read:false,type:null},{text:"Notice",read:false,type:null}]);assert.ok(events.length>0);
 await resetDatabase(driver);await seed();events=[];
 assert.equal(await repository.createAfterEmailNotification("alice","Notice"),true);
 assert.equal(await repository.createAfterEmailNotification("alice","Notice"),true);
 assert.deepEqual({rows:await rows(),events:normalize(events)},expected);
});
test("missing users retain false without events",async()=>{
 assert.equal(await oldWrite(),false);assert.equal(await repository.createAfterEmailNotification("alice","Notice"),false);
 assert.deepEqual(await rows(),[]);assert.deepEqual(events,[]);
});
test("projection failure preserves committed notification and first error",async()=>{
 await seed(false);let message="";
 await assert.rejects(oldWrite(),error=>{message=(error as Error).message;return true;});
 const expected={rows:await rows(),events:normalize(events)};
 await resetDatabase(driver);await seed(false);events=[];
 await assert.rejects(repository.createAfterEmailNotification("alice","Notice"),{message});
 assert.deepEqual({rows:await rows(),events:normalize(events)},expected);
});
test("fake mail delivery completes before in-app write and failed delivery prevents it",async()=>{
 for(const delivered of[true,false]){
  await resetDatabase(driver);await seed();events=[];let deliveries=0;
  const result=await sendEmailToUser("alice",{subject:"Subject",plainText:"Text",html:"<p>Text</p>"},{emailNotificationRepository:repository,sendMail:async(message)=>{
   deliveries++;assert.equal(message.to,"alice@example.test");assert.deepEqual(await rows(),[]);return delivered;
  }},{createInAppNotification:true,inAppText:"Notice"});
  assert.equal(result,delivered);assert.equal(deliveries,1);
  assert.equal((await rows()).length,delivered?1:0);
  if(!delivered)assert.deepEqual(events,[]);
 }
});
