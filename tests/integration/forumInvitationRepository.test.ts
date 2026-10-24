import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createForumInvitationRepository } from "../../services/persistence/forumInvitationRepository.js";
import { createEmailNotificationRepository } from "../../services/persistence/emailNotificationRepository.js";
import inviteForumOwner from "../../customResolvers/mutations/inviteForumOwner.js";
import inviteForumMod from "../../customResolvers/mutations/inviteForumMod.js";
import sgMail from "@sendgrid/mail";
import { Resend } from "resend";
import { mock, afterEach } from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
const engine = createSubscriptionEngine();
let events: unknown[] = [];
for (const kind of ["create", "update", "create_relationship", "delete_relationship", "delete"]) engine.events.on(kind, (event: unknown) => events.push(event));
before(async () => {
 driver = await startNeo4j();
 const app = getCustomResolvers(driver);
 const neoSchema = new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});
 const schema = await neoSchema.getSchema(); registerGeneratedSchema(driver,schema);
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
const currentWrite=(kind:"owner"|"moderator",username="alice")=>createForumInvitationRepository(driver)[kind==="owner"?"connectOwnerInvite":"connectModeratorInvite"]("cats",username);
const graph=async()=>plain((await driver.executeQuery("MATCH (u:User) OPTIONAL MATCH (:Channel)-[i:HAS_PENDING_INVITE|HAS_PENDING_MOD_INVITE]->(u) OPTIONAL MATCH (u)-[:HAS_NOTIFICATION]->(n:Notification) RETURN u.username AS username,count(DISTINCT i) AS invites,collect(DISTINCT {text:n.text,read:n.read,type:n.notificationType}) AS notifications ORDER BY username")).records.map(r=>r.toObject()));
for(const kind of ["owner","moderator"] as const){
 test(`${kind} repeated invitation writes preserve result and native events`,async(t)=>{
  await seed();const result=[plain(await currentWrite(kind)),plain(await currentWrite(kind))];t.assert.snapshot(result);t.assert.snapshot(normalize(events));t.assert.snapshot(await graph());
 });
 test(`${kind} projection failure preserves committed invite and events`,async(t)=>{
  await seed(false);await assert.rejects(currentWrite(kind),/Cannot return null for non-nullable field Channel\.createdAt/);t.assert.snapshot(normalize(events));t.assert.snapshot(await graph());
 });
 test(`${kind} missing targets and malformed inputs retain generated behavior`,async(t)=>{
  t.assert.snapshot(plain(await currentWrite(kind)));
  await seed();await driver.executeQuery("MATCH (u:User) DETACH DELETE u");
  events=[];t.assert.snapshot(plain(await currentWrite(kind)));t.assert.snapshot(normalize(events));
  await assert.rejects(currentWrite(kind,23 as any),/String cannot represent a non string value/);
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
