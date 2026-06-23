// Integration tests for enableServerPlugin against live Neo4j. The resolver
// ignores context (no auth), finds an installed plugin version, and flips the
// `enabled` edge property on the ServerConfig -[:INSTALLED]-> PluginVersion
// relationship.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

const seedInstalledPlugin = (enabled: boolean) =>
  run(
    `CREATE (p:Plugin { id: 'plugin-1', name: 'test-plugin', displayName: 'Test Plugin' })
     CREATE (pv:PluginVersion { id: 'pv-1', version: '1.0.0', entryPath: 'index.js', repoUrl: 'https://example.com/repo' })
     CREATE (p)-[:HAS_VERSION]->(pv)
     CREATE (sc:ServerConfig { serverName: 'test-server' })
     CREATE (sc)-[:INSTALLED { enabled: $enabled }]->(pv)`,
    { enabled }
  );

const enableServerPlugin = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.enableServerPlugin(null, args, {
    driver: env.driver,
    ogm: env.ogm,
  });

beforeEach(async () => {
  await resetDb();
});

const installedEnabledFlag = async () => {
  const rows = await run(
    `MATCH (:ServerConfig { serverName: 'test-server' })-[r:INSTALLED]->(:PluginVersion { version: '1.0.0' })
     RETURN r.enabled AS enabled`
  );
  return rows[0]?.enabled;
};

test("enables an installed plugin version (flips the INSTALLED edge to true)", async () => {
  await seedInstalledPlugin(false);

  await enableServerPlugin({ pluginId: "test-plugin", version: "1.0.0", enabled: true });

  assert.equal(await installedEnabledFlag(), true);
});

test("disables an enabled plugin version", async () => {
  await seedInstalledPlugin(true);

  await enableServerPlugin({ pluginId: "test-plugin", version: "1.0.0", enabled: false });

  assert.equal(await installedEnabledFlag(), false);
});

test("throws when the plugin does not exist", async () => {
  await seedInstalledPlugin(false);
  await assert.rejects(
    enableServerPlugin({ pluginId: "ghost", version: "1.0.0", enabled: true }),
    /not found/i
  );
});

test("throws when the version is installed nowhere", async () => {
  // Plugin + version exist, but no INSTALLED edge from a ServerConfig.
  await run(
    `CREATE (p:Plugin { id: 'plugin-1', name: 'test-plugin' })
     CREATE (pv:PluginVersion { id: 'pv-1', version: '1.0.0', entryPath: 'index.js', repoUrl: 'https://example.com/repo' })
     CREATE (p)-[:HAS_VERSION]->(pv)
     CREATE (:ServerConfig { serverName: 'test-server' })`
  );
  await assert.rejects(
    enableServerPlugin({ pluginId: "test-plugin", version: "1.0.0", enabled: true }),
    /not installed/i
  );
});
