import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createNotificationWriter } from "../../services/persistence/notificationWriter.js";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
const engine = createSubscriptionEngine();
let events: unknown[] = [];
for (const kind of ["create", "update", "create_relationship", "delete_relationship", "delete"]) engine.events.on(kind, event => events.push(event));
before(async () => {
 driver = await startNeo4j();
 const app = getCustomResolvers(driver);
 const neoSchema = new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema = await neoSchema.getSchema(); registerGeneratedSchema(driver,schema);
}, {timeout:240_000});
beforeEach(async () => {await resetDatabase(driver); events=[];});
after(async () => {await engine.close(); await stopNeo4j();});
const input = {username:"alice",text:"hello",notificationType:"general"};
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
const snapshot = async () => ({events:normalize(events), rows:(await driver.executeQuery("MATCH (:User)-[:HAS_NOTIFICATION]->(n:Notification) RETURN n.text AS text, n.read AS read, n.notificationType AS type ORDER BY text")).records.map(r=>r.toObject())});
const seed = async (valid = true) => {await driver.executeQuery(valid ? "CREATE (:User {username:'alice',createdAt:datetime('2020-01-01T00:00:00Z')})" : "CREATE (:User {username:'alice'})");};
test("missing recipients return false and publish no events", async (t) => {
 assert.equal(await createNotificationWriter(driver).createForUser(input),false); t.assert.snapshot(await snapshot());
});
test("nested writes preserve fields, repeated notifications and native subscription events", async (t) => {
 await seed();
 const writer=createNotificationWriter(driver); assert.equal(await writer.createForUser(input),true); assert.equal(await writer.createForUser(input),true);
 const result=await snapshot();
 assert.equal(result.rows.length,2); assert.ok(events.length>0);
 t.assert.snapshot(result);
});
test("projection failures preserve first error and committed writes/events", async (t) => {
 await seed(false);
 await assert.rejects(createNotificationWriter(driver).createForUser(input),/Cannot return null for non-nullable field User\.createdAt/);
 t.assert.snapshot(await snapshot());
});

test("invalid nested inputs retain coercion errors without graph writes or events", async () => {
 await seed();
 for (const malformed of [{...input,text:23},{...input,notificationType:23}]) {
  await assert.rejects(createNotificationWriter(driver).createForUser(malformed as any),/String cannot represent a non string value/);
  assert.deepEqual(await snapshot(),{events:[],rows:[]});
 }
});

test("nullable notification text retains generated-input acceptance", async (t) => {
 await seed();
 assert.equal(await createNotificationWriter(driver).createForUser({...input,text:null} as any),true);
 t.assert.snapshot(await snapshot());
});
