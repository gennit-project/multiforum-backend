import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { parse, print, type GraphQLResolveInfo } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createServerSecretRepository } from "../../services/persistence/serverSecretRepository.js";
import { migrateServerSecretRenames } from "../../services/plugin/reconcileSecrets.js";
import { decryptSecret } from "../../services/plugin/encryption.js";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
let app: ReturnType<typeof getCustomResolvers>;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ["create","update"]) engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{
  driver=await startNeo4j();app=getCustomResolvers(driver);
  const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});
  const schema=await neo.getSchema();registerGeneratedSchema(driver,schema);
},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{await engine.close();await stopNeo4j();});
const normalize=(value:unknown):unknown=>JSON.parse(JSON.stringify(value,(key,value)=>["id","timestamp","createdAt","updatedAt"].includes(key)?`<${key}>`:value));
const state=async()=>({rows:normalize((await driver.executeQuery("MATCH (s:ServerSecret) RETURN properties(s) AS secret ORDER BY s.key")).records.map(r=>r.get("secret"))),events:normalize(events)});
const seed=async(valid=true)=>driver.executeQuery(`CREATE (s:ServerSecret {id:'secret',pluginId:'scanner',key:'OLD',ciphertext:'synthetic-ciphertext',isValid:true,lastValidatedAt:datetime('2026-01-01T00:00:00Z'),validationError:'previous',updatedAt:datetime('2026-01-01T00:00:00Z'),createdAt:datetime('2026-01-01T00:00:00Z')}) ${valid?'':'REMOVE s.createdAt'}`);

test("replacement and creation retain generated defaults, validation reset and native events",async(t)=>{
  const repo=createServerSecretRepository(driver);
  await seed();t.assert.snapshot(await repo.findForReplacement("scanner","OLD"));
  await resetDatabase(driver);await seed();events=[];await repo.replaceCiphertext("secret","new-synthetic");t.assert.snapshot(await state());
  await resetDatabase(driver);events=[];await repo.createEncryptedSecret("scanner","NEW","synthetic","2026-01-02T00:00:00Z");t.assert.snapshot(await state());assert.ok(events.length>0);
});
test("rename preserves ciphertext and native update events; postcommit projection failures remain errors",async(t)=>{
  const repo=createServerSecretRepository(driver);await seed();
  t.assert.snapshot(await repo.findRenameCandidates("scanner"));
  await resetDatabase(driver);await seed();events=[];
  await migrateServerSecretRenames({serverSecretRepository:repo,pluginId:"scanner",oldManifest:{secrets:[{key:"OLD"}]},newManifest:{secrets:[{key:"NEW",renamedFrom:"OLD"}]}});t.assert.snapshot(await state());
  await resetDatabase(driver);await seed(false);events=[];await assert.rejects(repo.renameKey("secret","NEW"),/Cannot return null for non-nullable field ServerSecret\.createdAt/);t.assert.snapshot(await state());
});
test("wired secret setter encrypts synthetic input, resets validation, and wraps lookup errors",async()=>{
  await app.resolvers.Mutation.setServerPluginSecret(null,{pluginId:"scanner",key:"API",value:"synthetic-test-value"},{driver},{} as GraphQLResolveInfo);
  const repo=createServerSecretRepository(driver);let secret=(await repo.findForReplacement("scanner","API"))[0];assert.equal(decryptSecret(secret.ciphertext),"synthetic-test-value");assert.equal(secret.isValid,false);
  await driver.executeQuery("MATCH (s:ServerSecret) SET s.isValid=true,s.validationError='old',s.lastValidatedAt=datetime()");
  await app.resolvers.Mutation.setServerPluginSecret(null,{pluginId:"scanner",key:"API",value:"synthetic-replacement"},{driver},{} as GraphQLResolveInfo);
  secret=(await repo.findForReplacement("scanner","API"))[0];assert.equal(decryptSecret(secret.ciphertext),"synthetic-replacement");assert.equal(secret.isValid,false);assert.equal(secret.validationError,null);assert.equal(secret.lastValidatedAt,null);
  await driver.executeQuery("MATCH (s:ServerSecret) REMOVE s.createdAt");
  await assert.rejects(app.resolvers.Mutation.setServerPluginSecret(null,{pluginId:"scanner",key:"API",value:"synthetic"},{driver},{} as GraphQLResolveInfo),/Failed to set server plugin secret: Cannot return null/);
});
