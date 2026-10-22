import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createPipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js";
import { assertPublicPipelineTargetVisible } from "../../customResolvers/queries/pluginPipelineVisibility.js";
import createApplicability from "../../customResolvers/queries/getApplicablePluginPipeline.js";
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
// Nested relationship projections (collect()) have no guaranteed cross-run ordering, so deep-sort before snapshotting.
const sortDeep = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortDeep).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0))
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sortDeep(v)]))
      : value;

// Exact pre-migration projections, retained independently of repository documents.
const DISCUSSION_SELECTION = `{
        id
        deleted
        DownloadableFiles {
          id
          permanentlyRemoved
        }
        DiscussionChannels {
          archived
        }
      }`;
const FILE_SELECTION = `{
        id
        permanentlyRemoved
        Discussion {
          id
          deleted
          DiscussionChannels {
            channelUniqueName
            archived
          }
        }
      }`;
const TIMING_SELECTION = `{ id uploadedAt createdAt }`;
const SERVER_SELECTION = `{
      pluginPipelines
      InstalledVersionsConnection {
        edges {
          properties { enabled settingsJson }
          node {
            id version repoUrl tarballGsUri entryPath manifest
            settingsDefaults uiSchema
            Plugin {
              id name displayName description metadata
            }
          }
        }
      }
    }`;
const CHANNEL_SELECTION = `{ uniqueName pluginPipelines }`;

async function seed(): Promise<void> {
  await driver.executeQuery(`
    CREATE (discussion:Discussion {id: 'discussion', deleted: false})
    CREATE (file:DownloadableFile {id: 'file', createdAt: datetime('2026-01-01T00:00:00Z'), uploadedAt: datetime('2026-01-02T00:00:00Z')})
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(file)
    CREATE (channel:Channel {uniqueName: 'cats', pluginPipelines: $channelPipelines})
    CREATE (post:DiscussionChannel {id: 'post', channelUniqueName: 'cats', archived: false})
    CREATE (post)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (post)-[:POSTED_IN_CHANNEL]->(channel)
    CREATE (plugin:Plugin {id: 'scanner', name: 'scanner', displayName: 'Scanner'})
    CREATE (version:PluginVersion {id: 'version', version: '1.0.0', repoUrl: 'https://example.test/repo', entryPath: 'index.js', manifest: $manifest})
    CREATE (plugin)-[:HAS_VERSION]->(version)
    CREATE (:ServerConfig {serverName: 'server', pluginPipelines: $serverPipelines})-[:INSTALLED {enabled: true}]->(version)
  `, {
    channelPipelines: JSON.stringify([{ event: "discussionChannel.created", steps: [{ pluginId: "scanner" }] }]),
    serverPipelines: JSON.stringify([{ event: "downloadableFile.created", steps: [{ pluginId: "scanner" }] }]),
    manifest: JSON.stringify({ events: ["downloadableFile.created", "discussionChannel.created"] }),
  });
}

test("all five applicability/visibility projections match production OGM", async (t) => {
  await seed();
  const repository = createPipelineTargetRepository(driver);
  t.assert.snapshot(sortDeep(plain(await repository.findDiscussionVisibility("discussion"))));
  t.assert.snapshot(sortDeep(plain(await repository.findDownloadVisibility("file"))));
  t.assert.snapshot(sortDeep(plain(await repository.findDownloadTiming("file"))));
  t.assert.snapshot(sortDeep(plain(await repository.listServerApplicabilityConfigs())));
  t.assert.snapshot(sortDeep(plain(await repository.findChannelApplicabilityConfig("cats"))));
  const resolver = createApplicability({ driver });
  const server = await resolver(null, { downloadableFileId: "file" });
  const channel = await resolver(null, { downloadableFileId: "file", scope: "CHANNEL", discussionId: "discussion", channelUniqueName: "cats", eventType: "discussionChannel.created" });
  assert.equal(server.required, true);
  assert.equal(channel.required, true);
  assert.equal(server.expectedJobs[0].pluginId, "scanner");
  assert.equal(channel.targetId, "discussion");
});

test("context-free generated age filters keep restricted targets out of public pipeline reads", async (t) => {
  await seed();
  const repository = createPipelineTargetRepository(driver);
  await driver.executeQuery("MATCH (file:DownloadableFile {id: 'file'}) SET file.ageGateRestricted = true");
  assert.deepEqual(await repository.findDownloadVisibility("file"), []);
  for (const targetType of ["DownloadableFile", "Discussion"]) {
    await assert.rejects(assertPublicPipelineTargetVisible({ repository, targetId: targetType === "Discussion" ? "discussion" : "file", targetType }),
      (error: unknown) => (error as { extensions: { code: string } }).extensions.code === "NOT_FOUND");
  }
  await driver.executeQuery("MATCH (file:DownloadableFile {id: 'file'}) SET file.ageGateRestricted = false WITH file MATCH (d:Discussion {id: 'discussion'}) SET d.hasSensitiveContent = true");
  assert.deepEqual(await repository.findDiscussionVisibility("discussion"), []);
  t.assert.snapshot(sortDeep(plain(await repository.findDownloadVisibility("file"))));
  await assert.rejects(createApplicability({ driver })(null, { downloadableFileId: "file" }), /Pipeline target not found/);
});

test("archived/deleted/removed targets remain hidden and summary caller uses the same visibility guard", async () => {
  await seed();
  const repository = createPipelineTargetRepository(driver);
  const assertVisible = () => assertPublicPipelineTargetVisible({ repository, targetId: "file", targetType: "DownloadableFile" });
  assert.equal((await assertVisible()).id, "file");
  const summary = await app.resolvers.Query.getPipelineSummary(null, { targetId: "file", targetType: "DownloadableFile" });
  assert.deepEqual(summary.attempts, []);
  for (const statement of [
    "MATCH (post:DiscussionChannel) SET post.archived = true",
    "MATCH (post:DiscussionChannel) SET post.archived = false WITH post MATCH (file:DownloadableFile) SET file.permanentlyRemoved = true",
    "MATCH (file:DownloadableFile) SET file.permanentlyRemoved = false WITH file MATCH (d:Discussion) SET d.deleted = true",
  ]) {
    await driver.executeQuery(statement);
    await assert.rejects(assertVisible(), /Pipeline target not found/);
  }
});

test("nested visibility selections preserve generated limits and restricted channel filtering", async (t) => {
  await seed();
  await driver.executeQuery(`
    MATCH (discussion:Discussion {id: 'discussion'})
    UNWIND range(1, 27) AS n
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id: 'extra-' + toString(n)})
    CREATE (:DiscussionChannel {id: 'extra-post-' + toString(n), channelUniqueName: 'extra-' + toString(n), archived: false})-[:POSTED_IN_CHANNEL]->(discussion)
  `);
  const repository = createPipelineTargetRepository(driver);
  const discussions = await repository.findDiscussionVisibility("discussion");
  assert.equal(discussions[0].DownloadableFiles?.length, 25);
  assert.equal(discussions[0].DiscussionChannels?.length, 25);
  // The nested DownloadableFiles/DiscussionChannels projections apply a default limit of 25 over 28
  // rows; which 25 (and their order) is only stable within a run, so snapshot them reduced to a count.
  const discussionSnap = plain(discussions) as any;
  discussionSnap[0].DownloadableFiles = discussionSnap[0].DownloadableFiles.length;
  discussionSnap[0].DiscussionChannels = discussionSnap[0].DiscussionChannels.length;
  t.assert.snapshot(discussionSnap);
  await driver.executeQuery("MATCH (post:DiscussionChannel) SET post.ageGateRestricted = true");
  const downloads = await repository.findDownloadVisibility("file");
  t.assert.snapshot(sortDeep(plain(downloads)));
  assert.deepEqual(downloads[0].Discussion?.DiscussionChannels, []);
  await assert.rejects(assertPublicPipelineTargetVisible({ repository, targetId: "file", targetType: "DownloadableFile" }), /Pipeline target not found/);
});

test("missing required timing metadata retains the first GraphQL error", async () => {
  await seed();
  await driver.executeQuery("MATCH (file:DownloadableFile {id: 'file'}) REMOVE file.createdAt");
  await assert.rejects(createPipelineTargetRepository(driver).findDownloadTiming("file"), /Cannot return null for non-nullable field DownloadableFile\.createdAt/);
});
