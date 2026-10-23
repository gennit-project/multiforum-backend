import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import type { GraphQLContext } from "../../types/context.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createPluginConfigurationReadRepository } from "../../services/persistence/pluginConfigurationReadRepository.js";
import getInstalledPlugins from "../../customResolvers/queries/getInstalledPlugins.js";
import getServerPluginSecrets from "../../customResolvers/queries/getServerPluginSecrets.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let app: ReturnType<typeof getCustomResolvers>;
before(async () => {
  driver = await startNeo4j();
  app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({
    typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("secret-status projections match OGM without exposing ciphertext", async (t) => {
  await driver.executeQuery(`
    CREATE (:ServerSecret {pluginId: 'scanner', key: 'untested', ciphertext: 'synthetic-secret'})
    CREATE (:ServerSecret {pluginId: 'scanner', key: 'valid', ciphertext: 'synthetic-secret', isValid: true, lastValidatedAt: datetime('2026-01-02T03:04:05Z')})
    CREATE (:ServerSecret {pluginId: 'scanner', key: 'invalid', ciphertext: 'synthetic-secret', isValid: false, lastValidatedAt: datetime('2026-01-02T03:04:05Z'), validationError: 'Rejected'})
    CREATE (:ServerSecret {pluginId: 'other', key: 'other', ciphertext: 'synthetic-secret'})
  `);
  const repository = createPluginConfigurationReadRepository(driver);
  const actual = await repository.listPluginSecretStatuses("scanner");
  t.assert.snapshot(plain(actual));
  assert.equal(actual.length, 3);
  assert.doesNotMatch(JSON.stringify(actual), /ciphertext|synthetic-secret/);
  const response = await getServerPluginSecrets({ driver })(null, { pluginId: "scanner" }, {} as GraphQLContext, {} as never);
  assert.deepEqual(response.map(({ status }) => status).sort(), ["INVALID", "SET_UNTESTED", "VALID"]);
});

test("installed plugin projections preserve relationship data, metadata and unscoped config order", async (t) => {
  await driver.executeQuery(`
    CREATE (plugin:Plugin {id: 'plugin-id', name: 'scanner', displayName: 'Scanner', tags: ['scan'], metadata: '{"kind":"scanner"}'})
    CREATE (version:PluginVersion {id: 'version-id', version: '1.0.0', repoUrl: 'https://example.test/repo', entryPath: 'index.js', manifest: '{"name":"scanner"}', settingsDefaults: '{"enabled":true}', uiSchema: '{}', documentationPath: 'docs/index.md', readmeMarkdown: 'Read me'})
    CREATE (plugin)-[:HAS_VERSION]->(version)
    CREATE (config:ServerConfig {serverName: 'first'})-[:INSTALLED {enabled: true, settingsJson: '{"mode":"safe"}'}]->(version)
    CREATE (:ServerConfig {serverName: 'second'})
  `);
  const repository = createPluginConfigurationReadRepository(driver);
  t.assert.snapshot(plain(await repository.listInstalledPluginConfigs()));
  const result = await getInstalledPlugins({ driver })(null, {}, {} as GraphQLContext, {} as never);
  assert.equal(result.length, 1);
  assert.equal(result[0].enabled, true);
  assert.deepEqual(result[0].settingsJson, { mode: "safe" });
  assert.deepEqual(result[0].manifest, { name: "scanner" });
  assert.deepEqual(result[0].availableVersions, []);
});

test("reconciliation snapshots preserve global secret status and default apply preview wiring", async (t) => {
  await driver.executeQuery(`
    CREATE (:ServerConfig {serverName: 'server', pluginPipelines: '[]'})
    CREATE (:ServerSecret {pluginId: 'scanner', key: 'key', isValid: false, ciphertext: 'synthetic-secret'})
  `);
  const repository = createPluginConfigurationReadRepository(driver);
  t.assert.snapshot(plain(await repository.listReconciliationConfigs()));
  const secrets = await repository.listReconciliationSecretStatuses();
  t.assert.snapshot(plain(secrets));
  assert.doesNotMatch(JSON.stringify(secrets), /ciphertext|synthetic-secret/);
  // Exercise the actual default operation factory, not its injected test seam.
  // An already synchronized empty desired state must perform no mutation or IO.
  const result = await app.resolvers.Mutation.applyPluginConfiguration(null,
    { manifest: { apiVersion: "multiforum.gennit.dev/v1alpha1", plugins: [] } },
    { driver } as GraphQLContext, {} as never
  );
  assert.equal(result.status, "NO_CHANGES");
  assert.deepEqual(result.operations, []);
});

test("unused selected non-null plugin metadata retains the legacy error contract", async () => {
  await driver.executeQuery(`
    CREATE (plugin:Plugin {id: 'plugin-id', name: 'scanner'})
    CREATE (version:PluginVersion {id: 'version-id', version: '1.0.0', entryPath: 'index.js'})
    CREATE (plugin)-[:HAS_VERSION]->(version)
    CREATE (:ServerConfig {serverName: 'server'})-[:INSTALLED {enabled: true}]->(version)
  `);
  await assert.rejects(createPluginConfigurationReadRepository(driver).listInstalledPluginConfigs(), /Cannot return null for non-nullable field PluginVersion\.repoUrl/);
  await assert.rejects(getInstalledPlugins({ driver })(null, {}, {} as GraphQLContext, {} as never), /Failed to get installed plugins: Cannot return null for non-nullable field PluginVersion\.repoUrl/);
});
