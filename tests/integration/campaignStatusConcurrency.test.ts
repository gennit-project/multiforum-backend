import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema, type GraphQLObjectType } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import getResolvers from "../helpers/getTestResolvers.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createCampaignControlRepository } from "../../services/persistence/campaignControlRepository.js";
import { runPipelineCampaign } from "../../services/plugin/pipelineCampaign.js";
import { createCampaignServiceRepository } from "../../services/persistence/campaignServiceRepository.js";
import { PipelineApplicability, PluginPipelineCampaignStatus as Status } from "../../ogm_types.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver;
let schema: GraphQLSchema;
let raw: GraphQLSchema;
const originalServerConfig = process.env.SERVER_CONFIG_NAME;
before(async () => {
  driver = await startNeo4j();
  process.env.SERVER_CONFIG_NAME = "campaign-concurrency-fixture";
  raw = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers }).getSchema();
  registerGeneratedSchema(driver, raw);
  schema = applyMiddleware(raw, permissions);
}, { timeout: 240000 });
after(async () => {
  await stopNeo4j();
  if (originalServerConfig === undefined) delete process.env.SERVER_CONFIG_NAME;
  else process.env.SERVER_CONFIG_NAME = originalServerConfig;
});
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (s:ServerConfig {serverName:'campaign-concurrency-fixture'})
    CREATE (s)-[:HAS_DEFAULT_SERVER_ROLE]->(:ServerRole {canManagePlugins:false})
    CREATE (s)-[:HAS_DEFAULT_ADMIN_ROLE]->(:ServerRole {canManagePlugins:true})
    CREATE (:User {username:'admin'})-[:ADMIN_OF_SERVER]->(s)
    CREATE (:User {username:'ordinary'})
  `);
  const created = await createCampaignControlRepository(driver).create([{
    policyId:"policy",eventType:"downloadableFile.created",scope:"SERVER",
    applicability:PipelineApplicability.AllFilesGradual,enforcementBehavior:"fixture",
    status:Status.Running,concurrency:2,rateLimitPerMinute:5,
    affectedFileCount:0,accessibleFileCount:0,unavailableFileCount:0,estimatedProviderRuns:0,
    completedCount:0,runningCount:0,failedCount:0,timedOutCount:0,createdByUsername:"admin",
    updatedAt:"2026-01-01T00:00:00Z",
  }]);
  await driver.executeQuery("MATCH(c:PluginPipelineCampaign {id:$id}) SET c.id='campaign'", { id:created.pluginPipelineCampaigns[0].id });
});
function deferred() {
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
}
function execute(action: "pause" | "resume", id = "campaign", username: string | null = "admin") {
  const source = `mutation($id:ID!){result:${action}PluginPipelineCampaign(campaignId:$id){id status pausedAt updatedAt completedCount}}`;
  return graphql({ schema, source, variableValues:{id}, contextValue:{
    driver, req:{headers:{},body:{query:source}},
    user:username ? {username,email:null,email_verified:true,data:{}} : undefined,
  } });
}
function success(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data)).result;
}
function errorCode(result: Awaited<ReturnType<typeof execute>>, code: string) {
  assert.equal(result.errors?.[0].extensions.code, code, JSON.stringify(result));
  assert.equal(result.data, null);
}
async function state() {
  const result = await driver.executeQuery("MATCH(c:PluginPipelineCampaign {id:'campaign'}) RETURN c.status AS status,toString(c.pausedAt) AS pausedAt,toString(c.updatedAt) AS version,c.completedCount AS completedCount");
  const row = result.records[0];
  return row ? {
    status:row.get("status") as string,
    pausedAt:row.get("pausedAt") as string|null,
    version:row.get("version") as string,
    completedCount:row.get("completedCount").toNumber() as number,
  } : null;
}
// Wait on database-observed lock contention, never a timing guess about which
// request has read its snapshot. Only the disposable database is inspected.
async function waitForBlocked(count: number) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await driver.executeQuery("SHOW TRANSACTIONS YIELD currentQuery,status WHERE status STARTS WITH 'Blocked' AND currentQuery CONTAINS 'PluginPipelineCampaign' RETURN status");
    if (result.records.length >= count) return;
    await delay(10);
  }
  assert.fail(`Expected ${count} campaign requests blocked on the fixture transaction`);
}
async function heldChange(change: string, requests: () => Array<ReturnType<typeof execute>>) {
  const session = driver.session();
  const tx = session.beginTransaction();
  let pending: Array<ReturnType<typeof execute>> = [];
  try {
    await tx.run(`MATCH(c:PluginPipelineCampaign {id:'campaign'}) ${change}`);
    pending = requests();
    await waitForBlocked(pending.length);
    await tx.commit();
    return await Promise.all(pending);
  } finally {
    if (tx.isOpen()) await tx.rollback();
    await Promise.allSettled(pending);
    await session.close();
  }
}

test("sequential transitions preserve timestamps, repeat rejection, and missing errors", async () => {
  const paused = success(await execute("pause"));
  assert.equal(paused.status, "PAUSED");
  assert.ok(Number.isFinite(Date.parse(paused.pausedAt)));
  const beforeRepeat = await state();
  errorCode(await execute("pause"), "BAD_USER_INPUT");
  assert.deepEqual(await state(), beforeRepeat);
  const resumed = success(await execute("resume"));
  assert.equal(resumed.status, "RUNNING");
  assert.equal(resumed.pausedAt, null);
  errorCode(await execute("resume"), "BAD_USER_INPUT");
  for (const action of ["pause","resume"] as const) errorCode(await execute(action,"missing"), "NOT_FOUND");
});
for (const action of ["pause","resume"] as const) {
  const initial = action === "pause" ? "RUNNING" : "PAUSED";
  test(`${action}: overlapping requests have one success and one conflict`, async () => {
    await driver.executeQuery("MATCH(c:PluginPipelineCampaign) SET c.status=$status", {status:initial});
    const results = await heldChange("SET c.status=c.status", () => [execute(action),execute(action)]);
    assert.equal(results.filter(r => !r.errors).length, 1);
    errorCode(results.find(r => r.errors)!, "CONFLICT");
    assert.equal((await state())?.status, action === "pause" ? "PAUSED" : "RUNNING");
  });
  for (const later of ["COMPLETED","CANCELLED"]) {
    test(`${action}: a later ${later} state cannot be overwritten by a stale request`, async () => {
      await driver.executeQuery("MATCH(c:PluginPipelineCampaign) SET c.status=$status", {status:initial});
      const [result] = await heldChange(`SET c.status='${later}',c.updatedAt=datetime()`, () => [execute(action)]);
      errorCode(result, "CONFLICT");
      assert.equal((await state())?.status, later);
    });
  }
  test(`${action}: a changed version conflicts even when status returns to the expected value`, async () => {
    await driver.executeQuery("MATCH(c:PluginPipelineCampaign) SET c.status=$status", {status:initial});
    const [result] = await heldChange("SET c.status=c.status,c.updatedAt=datetime()", () => [execute(action)]);
    errorCode(result, "CONFLICT");
    assert.equal((await state())?.status, initial);
  });
  test(`${action}: deletion after the snapshot reports not-found rather than false success`, async () => {
    await driver.executeQuery("MATCH(c:PluginPipelineCampaign) SET c.status=$status", {status:initial});
    const [result] = await heldChange("DELETE c", () => [execute(action)]);
    errorCode(result, "NOT_FOUND");
    assert.equal(await state(), null);
  });
  for (const actor of [null,"ordinary"]) {
    test(`${action}: ${actor ?? "anonymous"} is denied without changing state`, async () => {
      const before = await state();
      const result = await execute(action,"campaign",actor);
      assert.ok(result.errors?.length);
      assert.deepEqual(await state(), before);
    });
  }
}

test("a response projection error still surfaces after committing the successful status write", async () => {
  const field = (raw.getType("PluginPipelineCampaign") as GraphQLObjectType).getFields().enforcementBehavior;
  const original = field.resolve;
  field.resolve = () => { throw new Error("fixture campaign projection failure"); };
  try {
    const result = await execute("pause");
    assert.match(result.errors?.[0].message ?? "", /fixture campaign projection failure/);
    assert.equal((await state())?.status, "PAUSED");
  } finally { field.resolve = original; }
});

test("documents a selected worker batch continuing after pause and completing it (existing behavior)", async () => {
  await driver.executeQuery("MATCH(s:ServerConfig) SET s.pluginPipelines=$policies", {
    policies:JSON.stringify([{policyId:"policy",event:"downloadableFile.created",effectiveAt:"2026-01-01T00:00:00Z",applicability:"ALL_FILES_GRADUAL",steps:[{pluginId:"fixture"}]}]),
  });
  const repository=createCampaignServiceRepository(driver);
  const campaign=(await repository.findRunningCampaigns())[0];
  const entered=deferred();
  const release=deferred();
  const dispatched:string[]=[];
  const worker=runPipelineCampaign({
    models:{driver,campaignRepository:{...repository,findFiles:async()=>[
      {id:"first",url:"https://fixture.test/first",uploadedAt:"2025-01-01T00:00:00Z",createdAt:"2025-01-01T00:00:00Z",permanentlyRemoved:false},
      {id:"second",url:"https://fixture.test/second",uploadedAt:"2025-01-01T00:00:00Z",createdAt:"2025-01-01T00:00:00Z",permanentlyRemoved:false},
    ]}},
    campaign,
    trigger:async args=>{
      dispatched.push(args.downloadableFileId);
      if(dispatched.length===1){entered.resolve();await release.promise;}
      return [];
    },
  });
  try {
    await Promise.race([entered.promise, worker.then(() => { throw new Error("Worker completed before the dispatch barrier"); })]);
    success(await execute("pause"));
    assert.equal((await state())?.status,"PAUSED");
  } finally {release.resolve(); await worker;}
  assert.deepEqual(dispatched,["first","second"]);
  assert.equal((await state())?.status,"COMPLETED");
});

test("database rejection rolls back the transition and releases its lock", async () => {
  await driver.executeQuery("CREATE CONSTRAINT campaign_status_failure_fixture IF NOT EXISTS FOR (c:PluginPipelineCampaign) REQUIRE c.status IS UNIQUE");
  try {
    await driver.executeQuery("CREATE (:PluginPipelineCampaign {id:'other',status:'PAUSED'})");
    const before=await state();
    const result=await execute("pause");
    assert.ok(result.errors?.length,"a rejected database write must not report success");
    assert.deepEqual(await state(),before);
  } finally {await driver.executeQuery("DROP CONSTRAINT campaign_status_failure_fixture IF EXISTS");}
  assert.equal(success(await execute("pause")).status,"PAUSED");
});

test("temporary lock marker leaves existing properties unchanged", async () => {
  await driver.executeQuery("MATCH(c:PluginPipelineCampaign) SET c._campaignTransitionLock='legacy-marker'");
  success(await execute("pause"));
  const row=(await driver.executeQuery("MATCH(c:PluginPipelineCampaign) RETURN c._campaignTransitionLock AS value")).records[0];
  assert.equal(row.get("value"),"legacy-marker");
});

test("delete-and-recreate cannot apply a stale action to a replacement campaign", async () => {
  const [result]=await heldChange("WITH c,properties(c) AS props DELETE c CREATE (replacement:PluginPipelineCampaign) SET replacement=props,replacement.updatedAt=datetime()",()=>[execute("pause")]);
  assert.ok(["NOT_FOUND","CONFLICT"].includes(String(result.errors?.[0].extensions.code)),JSON.stringify(result));
  assert.equal((await state())?.status,"RUNNING");
});


test("draft and terminal states retain BAD_USER_INPUT without modifying the campaign", async () => {
  for (const status of ["DRAFT","COMPLETED","CANCELLED"]) {
    await driver.executeQuery("MATCH(c:PluginPipelineCampaign) SET c.status=$status", {status});
    const before=await state();
    for (const action of ["pause","resume"] as const) errorCode(await execute(action),"BAD_USER_INPUT");
    assert.deepEqual(await state(),before);
  }
});
