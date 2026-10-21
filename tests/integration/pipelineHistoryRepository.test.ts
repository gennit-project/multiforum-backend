import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { SortDirection } from "../../ogm_types.js";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createPipelineHistoryRepository } from "../../services/persistence/pipelineHistoryRepository.js";
import { PUBLIC_PIPELINE_ATTEMPT_SELECTION, PUBLIC_PLUGIN_JOB_SELECTION } from "../../services/plugin/publicPipeline.js";
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
  initializeOgmFromExistingSchema(app.ogm, neoSchema, schema);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const HISTORY = `{
        id
        pluginId
        pluginName
        version
        scope
        channelId
        eventType
        status
        message
        durationMs
        targetId
        targetType
        payload
        pipelineId
        executionOrder
        skippedReason
        createdAt
        updatedAt
      }`;
const DOWNLOAD = `{
        id
        pluginId
        version
        scope
        channelId
        eventType
        status
        message
        durationMs
        targetId
        targetType
        payload
        createdAt
        updatedAt
      }`;
async function seed(): Promise<void> {
  await driver.executeQuery(`
    CREATE (d:Discussion {id:'discussion', deleted:false})-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'file'})
    CREATE (:DiscussionChannel {id:'post', channelUniqueName:'cats', archived:false})-[:POSTED_IN_CHANNEL]->(d)
    WITH d UNWIND range(0, 27) AS n
    CREATE (:PluginRun {id:'job-'+toString(n), pluginId:'scanner', version:'1.0', scope:'SERVER', eventType:'downloadableFile.created', status:'SUCCEEDED', targetId:'file', targetType:'DownloadableFile', payload:'private payload', message:'private message', pipelineId:'pipeline-'+toString(n), executionOrder:n, createdAt:datetime('2026-01-01T00:00:00Z')+duration({seconds:n}), updatedAt:datetime('2026-01-01T00:00:00Z')})
    CREATE (:PluginPipelineRun {id:'attempt-'+toString(n), pipelineId:'pipeline-'+toString(n), targetId:'file', targetType:'DownloadableFile', eventType:'downloadableFile.created', scope:'SERVER', status:'SUCCEEDED', trigger:'EVENT', attemptNumber:n+1, configurationSnapshot:'private configuration', createdAt:datetime('2026-01-01T00:00:00Z')+duration({seconds:n}), updatedAt:datetime('2026-01-01T00:00:00Z')})
  `);
}

test("four history/summary projections preserve OGM filtering, ordering and unbounded generated defaults", async () => {
  await seed();
  const repository = createPipelineHistoryRepository(driver);
  const runs = await repository.findPipelineHistory("file", "DownloadableFile");
  assert.equal(runs.length, 28);
  assert.deepEqual(plain(runs), plain(await app.ogm.model("PluginRun").find({where:{AND:[{targetId:"file"},{targetType:"DownloadableFile"}]}, options:{sort:[{pipelineId:SortDirection.Desc},{executionOrder:SortDirection.Asc},{createdAt:SortDirection.Desc}]}, selectionSet:HISTORY})));
  assert.deepEqual(plain(await repository.findDownloadHistory("file")), plain(await app.ogm.model("PluginRun").find({where:{AND:[{targetId:"file"},{targetType:"DownloadableFile"}]},options:{sort:[{createdAt:SortDirection.Desc}]},selectionSet:DOWNLOAD})));
  const attempts = await repository.findSummaryAttempts("file", "DownloadableFile");
  assert.equal(attempts.length, 28);
  assert.equal(attempts[0].id, "attempt-27");
  assert.deepEqual(plain(attempts), plain(await app.ogm.model("PluginPipelineRun").find({where:{targetId:"file",targetType:"DownloadableFile"},options:{sort:[{createdAt:SortDirection.Desc}]},selectionSet:PUBLIC_PIPELINE_ATTEMPT_SELECTION})));
  assert.deepEqual(plain(await repository.findSummaryJobs("file", "DownloadableFile")), plain(await app.ogm.model("PluginRun").find({where:{targetId:"file",targetType:"DownloadableFile"},selectionSet:PUBLIC_PLUGIN_JOB_SELECTION})));
  assert.deepEqual(await repository.findDownloadHistory("missing"), []);
});

test("actual summary caller retains visibility gate and public redaction; raw histories retain payload", async () => {
  await seed();
  const summary = await app.resolvers.Query.getPipelineSummary(null,{targetId:"file",targetType:"DownloadableFile"});
  assert.equal(summary.attempts.length,28);
  assert.equal(summary.attempts[0].id,"attempt-27");
  assert.ok(!JSON.stringify(summary).includes("private"));
  const raw = await app.resolvers.Query.getPipelineRuns(null,{targetId:"file",targetType:"DownloadableFile"}, {} as GraphQLContext, {} as GraphQLResolveInfo);
  assert.equal(raw[0].payload,"private payload");
  const download = await app.resolvers.Query.getPluginRunsForDownloadableFile(null,{downloadableFileId:"file"}, {} as GraphQLContext, {} as GraphQLResolveInfo);
  assert.equal(download[0].id,"job-27");
  await driver.executeQuery("MATCH (d:Discussion) SET d.deleted=true");
  await assert.rejects(app.resolvers.Query.getPipelineSummary(null,{targetId:"file",targetType:"DownloadableFile"}), /Pipeline target not found/);
});

test("generated variable coercion and selected nonnull errors match legacy first errors", async () => {
  await seed();
  const repository = createPipelineHistoryRepository(driver);
  const args = {AND:[{targetId:42},{targetType:"DownloadableFile"}]};
  const oldError = await app.ogm.model("PluginRun").find({where:args as never, selectionSet:HISTORY}).then(() => assert.fail("expected coercion error"), (error:Error) => error.message);
  await assert.rejects(repository.findPipelineHistory(42 as unknown as string,"DownloadableFile"),{message:oldError});
  await driver.executeQuery("MATCH (job:PluginRun) REMOVE job.version");
  const missing = await app.ogm.model("PluginRun").find({where:{AND:[{targetId:"file"},{targetType:"DownloadableFile"}]},selectionSet:DOWNLOAD}).then(() => assert.fail("expected missing version error"),(error:Error)=>error.message);
  await assert.rejects(repository.findDownloadHistory("file"),{message:missing});
});
