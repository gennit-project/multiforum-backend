import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { parse, print } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createForumInvitationRepository } from "../../services/persistence/forumInvitationRepository.js";
import { createEmailNotificationRepository } from "../../services/persistence/emailNotificationRepository.js";
import inviteForumOwner from "../../customResolvers/mutations/inviteForumOwner.js";
import inviteForumMod from "../../customResolvers/mutations/inviteForumMod.js";
import sgMail from "@sendgrid/mail";
import { Resend } from "resend";
import { mock, afterEach } from "node:test";
import { CHANNEL_MEMBERSHIP_SELECTION } from "../../services/persistence/forumMembershipSelections.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
const engine = createSubscriptionEngine();
let events: unknown[] = [];
for (const kind of ["create", "update", "create_relationship", "delete_relationship", "delete"]) engine.events.on(kind, event => events.push(event));
before(async () => {
 driver = await startNeo4j();
 const app = getCustomResolvers(driver); ogm = app.ogm;
 const neoSchema = new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema = await neoSchema.getSchema(); initializeOgmFromExistingSchema(ogm,neoSchema,schema); registerGeneratedSchema(driver,schema);
}, {timeout:240_000});
beforeEach(async () => {await resetDatabase(driver); events=[];});
after(async () => {await engine.close(); await stopNeo4j();});
const normalize = (value: unknown): unknown => {
 const identities = new Map<string,string>();
 return JSON.parse(JSON.stringify(value,function(key,value) {
  if (["id","id_from","id_to"].includes(key)) {
   const namespace = key === "id" && this.event?.includes("relationship") ? "relationship" : "node";
   const identity = `${namespace}:${value}`;
   if (!identities.has(identity)) identities.set(identity,`<id-${identities.size}>`);
   return identities.get(identity);
  }
  return ["timestamp","createdAt","updatedAt"].includes(key) ? "<generated-time>" : value;
 }));
};
let nativeCalls=0;
before(()=>{
 process.env.FRONTEND_URL="https://example.test";process.env.EMAIL_PROVIDER="resend";process.env.EMAIL_FROM="test@example.test";process.env.RESEND_API_KEY="fake-test-key";process.env.SENDGRID_API_KEY="fake-test-key";
 mock.method(sgMail,"send",async()=>{nativeCalls++;throw new Error("Native SendGrid forbidden");});mock.method(Resend.prototype,"post",async()=>{nativeCalls++;throw new Error("Native Resend forbidden");});
});
afterEach(()=>assert.equal(nativeCalls,0));after(()=>mock.restoreAll());
const seed=async(valid=true)=>{await driver.executeQuery("CREATE (:Channel {uniqueName:'cats',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (u:User {username:'alice',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:Email {address:'alice@example.test'})-[:HAS_EMAIL]->(u)");if(!valid)await driver.executeQuery("MATCH (c:Channel) REMOVE c.createdAt");};
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const oldWrite=(kind:"owner"|"moderator",username:unknown="alice")=>ogm.model("Channel").update({where:{uniqueName:"cats"},update:{[kind==="owner"?"PendingOwnerInvites":"PendingModInvites"]:[{connect:[{where:{node:{username}}}]}]}} as any);
const currentWrite=(kind:"owner"|"moderator",username="alice")=>createForumInvitationRepository(driver)[kind==="owner"?"connectOwnerInvite":"connectModeratorInvite"]("cats",username);
const graph=async()=>plain((await driver.executeQuery("MATCH (u:User) OPTIONAL MATCH (:Channel)-[i:HAS_PENDING_INVITE|HAS_PENDING_MOD_INVITE]->(u) OPTIONAL MATCH (u)-[:HAS_NOTIFICATION]->(n:Notification) RETURN u.username AS username,count(DISTINCT i) AS invites,collect(DISTINCT {text:n.text,read:n.read,type:n.notificationType}) AS notifications ORDER BY username")).records.map(r=>r.toObject()));
test("forum invitation selection preserves full default Channel projection",()=>assert.equal(print(parse(CHANNEL_MEMBERSHIP_SELECTION)),print(parse((ogm.model("Channel") as unknown as {getSelectionSetOrDefault():string}).getSelectionSetOrDefault()))));
for(const kind of ["owner","moderator"] as const){
 test(`${kind} repeated invitation writes preserve result and native events`,async()=>{
  await seed();const expected=[plain(await oldWrite(kind)),plain(await oldWrite(kind))];const oldEvents=normalize(events);const oldGraph=await graph();
  await resetDatabase(driver);await seed();events=[];const result=[plain(await currentWrite(kind)),plain(await currentWrite(kind))];assert.deepEqual(result,expected);assert.deepEqual(normalize(events),oldEvents);assert.deepEqual(await graph(),oldGraph);
 });
 test(`${kind} projection failure preserves committed invite and events`,async()=>{
  await seed(false);let message="";await assert.rejects(oldWrite(kind),error=>{message=(error as Error).message;return true;});const oldEvents=normalize(events);const oldGraph=await graph();
  await resetDatabase(driver);await seed(false);events=[];await assert.rejects(currentWrite(kind),{message});assert.deepEqual(normalize(events),oldEvents);assert.deepEqual(await graph(),oldGraph);
 });
 test(`${kind} missing targets and malformed inputs retain generated behavior`,async()=>{
  assert.deepEqual(plain(await currentWrite(kind)),plain(await oldWrite(kind)));
  await seed();await driver.executeQuery("MATCH (u:User) DETACH DELETE u");
  events=[];const expected=plain(await oldWrite(kind));const oldEvents=normalize(events);events=[];
  assert.deepEqual(plain(await currentWrite(kind)),expected);assert.deepEqual(normalize(events),oldEvents);
  let message="";await assert.rejects(oldWrite(kind,23),error=>{message=(error as Error).message;return true;});await assert.rejects(currentWrite(kind,23 as any),{message});
 });
 test(`${kind} resolver keeps invitation committed on email failure and repeats notifications without adding a type`,async()=>{
  await seed();const deliveryOrder:string[]=[];let successful=false;
  const repository=createEmailNotificationRepository(driver);
  const resolver=(kind==="owner"?inviteForumOwner:inviteForumMod)({driver,emailDelivery:{emailNotificationRepository:repository,sendMail:async()=>{deliveryOrder.push("email");return successful;}}});
  const invoke=()=>resolver(null,{channelUniqueName:"cats",inviteeUsername:"alice"},{} as GraphQLContext,{} as GraphQLResolveInfo);
  assert.equal(await invoke(),false);assert.equal((await driver.executeQuery("MATCH (:Channel)-[i:HAS_PENDING_INVITE|HAS_PENDING_MOD_INVITE]->(:User) RETURN count(i) AS n")).records[0].get("n").toNumber(),1);
  successful=true;assert.equal(await invoke(),true);assert.equal(await invoke(),true);
  const notifications=await driver.executeQuery("MATCH (n:Notification) RETURN n.notificationType AS type,n.read AS read");assert.equal(notifications.records.length,2);for(const row of notifications.records){assert.equal(row.get("type"),null);assert.equal(row.get("read"),false);}assert.deepEqual(deliveryOrder,["email","email","email"]);
 });
 test(`${kind} default factory repository wiring stops before native mail for a missing address`,async()=>{
  await seed();await driver.executeQuery("MATCH (e:Email) DETACH DELETE e");
  const resolver=(kind==="owner"?inviteForumOwner:inviteForumMod)({driver});
  assert.equal(await resolver(null,{channelUniqueName:"cats",inviteeUsername:"alice"},{} as GraphQLContext,{} as GraphQLResolveInfo),false);
  assert.equal(nativeCalls,0);
 });

}
