import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { parse, print } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createServerPipelineRepository } from "../../services/persistence/serverPipelineRepository.js";
import { createSubscriptionEngine } from "../../services/subscriptionEngine.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
let app: ReturnType<typeof getCustomResolvers>;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ["create","update"]) engine.events.on(kind,event=>events.push(event));
before(async()=>{
  driver=await startNeo4j();app=getCustomResolvers(driver);
  const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
  const schema=await neo.getSchema();initializeOgmFromExistingSchema(app.ogm,neo,schema);registerGeneratedSchema(driver,schema);
},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{await engine.close();await stopNeo4j();});
const normalize=(value:unknown):unknown=>JSON.parse(JSON.stringify(value,(key,value)=>["timestamp","id","id_from","id_to"].includes(key)?`<${key}>`:value));
test("current projection and generated update retain native events and nullable serverName behavior",async(t)=>{
  const repo=createServerPipelineRepository(driver);
  await driver.executeQuery("CREATE (:ServerConfig {serverName:'test',pluginPipelines:'[]'})");
  t.assert.snapshot(await repo.listCurrent());
  events=[];
  await repo.save("test",'[{"event":"comment.created"}]');t.assert.snapshot(normalize(events));
  await resetDatabase(driver);await driver.executeQuery("CREATE (:ServerConfig {pluginPipelines:'[]'})");
  t.assert.snapshot(await repo.listCurrent());
  events=[];
  await repo.save(null,'["null-key"]');t.assert.snapshot(await repo.listCurrent());t.assert.snapshot(normalize(events));
});
test("wired pipeline mutation normalizes policy defaults and persists exactly returned data",async()=>{
  await driver.executeQuery("CREATE (:ServerConfig {serverName:'test'})");
  const result=await app.resolvers.Mutation.updatePluginPipelines(null,{pipelines:[{event:"downloadableFile.created",steps:[{pluginId:"scanner"}]}]}, {}, {});
  assert.equal(result[0].applicability,"NEW_FILES_ONLY");assert.ok(result[0].policyId);assert.ok(result[0].effectiveAt);
  const persisted=await createServerPipelineRepository(driver).listCurrent();assert.deepEqual(JSON.parse(String(persisted[0].pluginPipelines)),result);
});

test("unused default projection failures remain postcommit errors",async(t)=>{
  const repo=createServerPipelineRepository(driver);
  await driver.executeQuery("CREATE (:ServerConfig {serverName:'test',enableDownloads:'invalid-boolean',pluginPipelines:'[]'})");
  events=[];
  await assert.rejects(repo.save("test",'["changed"]'),/Boolean cannot represent a non boolean value/);t.assert.snapshot(normalize(events));
  assert.equal((await repo.listCurrent())[0].pluginPipelines,'["changed"]');
});
