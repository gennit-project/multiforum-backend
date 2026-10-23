import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createPipelineDetailRepository } from "../../services/persistence/pipelineDetailRepository.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let app: ReturnType<typeof getCustomResolvers>;
before(async () => {
  driver = await startNeo4j();
  app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

async function seed(): Promise<void> {
  await driver.executeQuery(`
    CREATE (d:Discussion {id:'discussion', deleted:false})-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'file'})
    CREATE (:DiscussionChannel {id:'post', channelUniqueName:'cats', archived:false})-[:POSTED_IN_CHANNEL]->(d)
    CREATE (:PluginPipelineRun {id:'attempt', pipelineId:'pipeline', targetId:'file', targetType:'DownloadableFile', eventType:'downloadableFile.created', scope:'SERVER', status:'SUCCEEDED', trigger:'EVENT', attemptNumber:1, configurationSnapshot:'private configuration', createdAt:datetime('2026-01-01T00:00:00Z'), updatedAt:datetime('2026-01-01T00:00:00Z')})
    WITH d UNWIND range(0,27) AS n
    CREATE (:PluginRun {id:'job-'+toString(n), pluginId:'scanner', version:'1.0', scope:'SERVER', eventType:'downloadableFile.created', status:'SUCCEEDED', targetId:'file', targetType:'DownloadableFile', payload:'private payload', message:'private message', leaseId:'private lease', pipelineId:'pipeline', executionOrder:27-n, createdAt:datetime('2026-01-01T00:00:00Z'), updatedAt:datetime('2026-01-01T00:00:00Z')})
  `);
}

test("all four detail projections retain OGM filtering, sort, and unbounded job defaults", async (t) => {
  await seed(); const repository=createPipelineDetailRepository(driver);
  t.assert.snapshot(plain(await repository.findPublicAttempt("attempt")));
  t.assert.snapshot(plain(await repository.findInternalAttempt("attempt")));
  const jobs=await repository.findPublicJobs("pipeline");
  assert.equal(jobs.length,28); assert.equal(jobs[0].id,"job-27");
  t.assert.snapshot(plain(jobs));
  t.assert.snapshot(plain(await repository.findInternalJobs("pipeline")));
});

test("wired public and internal detail retain distinct visibility/redaction contracts and missing null", async () => {
  await seed();
  const publicResult=await app.resolvers.Query.getPublicPipelineRun(null,{pipelineRunId:"attempt"});
  assert.equal(publicResult?.jobs.length,28);assert.ok(!JSON.stringify(publicResult).includes("private"));
  const internal=await app.resolvers.Query.getInternalPluginPipelineRun(null,{pipelineRunId:"attempt"});
  assert.equal(internal?.attempt.configurationSnapshot,"private configuration");assert.equal(internal?.jobs[0].payload,"private payload");assert.equal(internal?.jobs[0].leaseId,"private lease");
  await driver.executeQuery("MATCH (d:Discussion) SET d.deleted=true");
  await assert.rejects(app.resolvers.Query.getPublicPipelineRun(null,{pipelineRunId:"attempt"}),/Pipeline target not found/);
  assert.ok(await app.resolvers.Query.getInternalPluginPipelineRun(null,{pipelineRunId:"attempt"}));
  assert.equal(await app.resolvers.Query.getPublicPipelineRun(null,{pipelineRunId:"missing"}),null);
  assert.equal(await app.resolvers.Query.getInternalPluginPipelineRun(null,{pipelineRunId:"missing"}),null);
});

test("malformed attempt identifiers and missing selected nonnull fields preserve first errors", async (t) => {
  await seed();const repository=createPipelineDetailRepository(driver);
  t.assert.snapshot(plain(await repository.findInternalAttempt(42 as unknown as string)));
  await assert.rejects(repository.findInternalAttempt({bad:true} as unknown as string),/ID cannot represent/);
  await driver.executeQuery("MATCH (j:PluginRun) REMOVE j.version");
  await assert.rejects(repository.findPublicJobs("pipeline"),/Cannot return null for non-nullable field PluginRun\.version/);
  await assert.rejects(repository.findInternalJobs("pipeline"),/Cannot return null for non-nullable field PluginRun\.version/);
});
