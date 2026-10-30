import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import neo4j from 'neo4j-driver';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {Neo4jContainer} from '@testcontainers/neo4j';
import typeDefs from '../typeDefs.js';
import getCustomResolvers from '../tests/helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../services/persistence/generatedSchemaOperations.js';
import {summaryPageQueries, summaryAttemptsPageQuery, createPipelineSummaryPageRepository} from '../services/persistence/pipelineSummaryPageRepository.js';
import {ensurePipelineSummaryIndexes} from '../services/pipelineSummaryIndexes.js';
import {summarizeProfile, evaluateProfile, type ProfilePlan} from '../services/cypherPerformanceBudget.js';
import createLegacySummary from '../customResolvers/queries/getPluginPipelineSummary.js';
import {createPipelineSummaryPage} from '../customResolvers/queries/getPluginPipelinePage.js';

// Disposable data only. Never use the environment's application database.
const container = await new Neo4jContainer(process.env.NEO4J_TEST_IMAGE || 'neo4j:5-community').withApoc().start();
const driver = neo4j.driver(container.getBoltUri(), neo4j.auth.basic(container.getUsername(), container.getPassword()));
const output = process.argv[2] ?? 'performance-results/pipeline-summary.json';
const reports: unknown[] = [];
try {
  const app = getCustomResolvers(driver);
  const schema = await new Neo4jGraphQL({typeDefs, driver, resolvers:app.resolvers, features:{filters:{String:{MATCHES:true}}, subscriptions:true}}).getSchema();
  registerGeneratedSchema(driver, schema);
  await ensurePipelineSummaryIndexes(driver);
  await driver.executeQuery('CREATE CONSTRAINT summary_fixture_discussion_id IF NOT EXISTS FOR (n:Discussion) REQUIRE n.id IS UNIQUE');
  await driver.executeQuery('CREATE CONSTRAINT summary_fixture_file_id IF NOT EXISTS FOR (n:DownloadableFile) REQUIRE n.id IS UNIQUE');
  await driver.executeQuery('CALL db.awaitIndexes()');
  const repository = createPipelineSummaryPageRepository(driver);
  const args = {targetId:'file', targetType:'DownloadableFile'};
  const filter = {...args, scope:null, channelId:null, eventType:null};
  const old = createLegacySummary({driver});
  const bounded = createPipelineSummaryPage({driver});
  for (const fixture of [{attempts:100, jobs:20}, {attempts:2000, jobs:20}, {attempts:1, jobs:10000}]) {
    await driver.executeQuery('MATCH (n) DETACH DELETE n');
    await driver.executeQuery(`CREATE (d:Discussion {id:'discussion',deleted:false})-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'file'})
      CREATE (:DiscussionChannel {id:'post',channelUniqueName:'cats',archived:false})-[:POSTED_IN_CHANNEL]->(d)`);
    // Batch writes to avoid a fixture transaction dominating the measurements.
    for (let start=0; start<fixture.attempts; start+=100) {
      await driver.executeQuery(`UNWIND range($start, $end) AS n
        CREATE (a:PluginPipelineRun {id:'attempt-'+toString(n), pipelineId:'pipeline-'+toString(n), targetId:'file', targetType:'DownloadableFile', scope:'SERVER', eventType:'downloadableFile.created', status:'SUCCEEDED', trigger:'EVENT', attemptNumber:n+1, configurationSnapshot:'{}', createdAt:datetime('2026-01-01T00:00:00Z')+duration({seconds:n}), updatedAt:datetime('2026-01-01T00:00:00Z')})
        WITH a UNWIND range(1, $jobs) AS j
        CREATE (:PluginRun {id:a.id+'-job-'+toString(j), pipelineId:a.pipelineId, targetId:a.targetId, targetType:a.targetType, scope:a.scope, eventType:a.eventType, pluginId:'scanner', version:'1', status:'SUCCEEDED', executionOrder:j, payload:'private', message:'private', publicDiagnostics:'[]', createdAt:a.createdAt, updatedAt:a.updatedAt})`,
        {start:neo4j.int(start), end:neo4j.int(Math.min(start+99,fixture.attempts-1)), jobs:neo4j.int(fixture.jobs)});
    }
    const measure = async (call:()=>Promise<unknown>) => {
      await call();
      const samples = [];
      for (let i=0;i<5;i++) {
        global.gc?.();
        const heapBefore = process.memoryUsage().heapUsed;
        const start = performance.now();
        const result = await call();
        const ms = performance.now()-start;
        const heapGrowth = process.memoryUsage().heapUsed-heapBefore;
        samples.push({ms, heapGrowth, responseBytes:Buffer.byteLength(JSON.stringify(result))});
      }
      return samples;
    };
    console.log(`Measuring ${fixture.attempts} attempts x ${fixture.jobs} jobs`);
    const baseline = await measure(()=>old(null,args));
    const after = await measure(async()=>{
      const response = await bounded(null,{...args,first:10,jobsFirst:20});
      assert.ok(response.attempts.length <= 10);
      assert.ok(response.attempts.every(attempt => attempt.run.jobs.length <= 20));
      return response;
    });
    const attempts = await repository.findAttempts(filter,10,null);
    const parameters = {...filter, limit:neo4j.int(11), afterId:null, afterCreatedAt:null, afterOrder:null};
    const middle = Math.floor(fixture.attempts / 2);
    const cursor = {id:`attempt-${middle}`,createdAt:new Date(Date.UTC(2026,0,1)+middle*1000).toISOString(),order:0};
    const profiles = [];
    for (const [name,query,params] of [
      ['attempts',summaryPageQueries.attempts,parameters],
      ['attemptsAfter',summaryAttemptsPageQuery(cursor),{...parameters,afterId:cursor.id,afterCreatedAt:cursor.createdAt}],
      ['flags',summaryPageQueries.flags,filter],
      ['jobs',summaryPageQueries.jobs,{...parameters,limit:neo4j.int(21),attempts}],
      // Equivalent unbounded database reads; resolver measurements above use the actual legacy API.
      ['legacyAttempts',summaryPageQueries.attempts.replace(' LIMIT $limit',''),parameters],
      ['legacyJobs',`MATCH (j:PluginRun {targetId:$targetId,targetType:$targetType}) RETURN j`,filter],
    ] as const) {
      let metrics;
      for (let warm=0;warm<2;warm++) {
        const result = await driver.executeQuery('PROFILE '+query,params);
        metrics = summarizeProfile(result.summary.profile as ProfilePlan,result.records.length);
        if (name === 'jobs') assert.ok(result.records.every(row => row.get('jobs').length <= 21));
      }
      // History-independent budgets cover selection and activity. Job ordering has a
      // separately reported fan-out cost: legacy null executionOrder requires coalesce/sort.
      const budget = name.startsWith('attempts') ? {baseDbHits:1000, dbHitsPerRequestedRow:200,baseIntermediateRows:20,intermediateRowsPerRequestedRow:5,requestedRows:10} :
        name==='flags' ? {baseDbHits:1000, dbHitsPerRequestedRow:0,baseIntermediateRows:20,intermediateRowsPerRequestedRow:0,requestedRows:1} :
        name==='jobs' && fixture.jobs===20 ? {baseDbHits:1000,dbHitsPerRequestedRow:20,baseIntermediateRows:20,intermediateRowsPerRequestedRow:2,requestedRows:Math.min(fixture.attempts,10)*20} : null;
      const evaluation = budget && metrics ? evaluateProfile(metrics,budget) : null;
      profiles.push({name,metrics,evaluation});
      console.log(JSON.stringify({fixture, name, metrics, evaluation}));
      if (evaluation && !evaluation.passed) {
        console.error(`Budget failed: ${name}: ${evaluation.violations.join('; ')}`);
        process.exitCode=1;
      }
    }
    reports.push({fixture,baseline,after,profiles});
  }
  await fs.mkdir(new URL('../performance-results/',import.meta.url),{recursive:true});
  await fs.writeFile(output,JSON.stringify({node:process.version,neo4j:await driver.getServerInfo(),page:{attempts:10,jobs:20},reports},null,2));
  console.log(`Pipeline summary measurements: ${output}`);
} finally {
  await driver.close();
  await container.stop();
}
