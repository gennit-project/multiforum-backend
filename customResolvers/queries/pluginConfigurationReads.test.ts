import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { PluginConfigurationReadRepository } from "../../services/persistence/pluginConfigurationReadRepository.js";
import getServerPluginSecrets from "./getServerPluginSecrets.js";
import getInstalledPlugins from "./getInstalledPlugins.js";
import previewReconciliation from "./previewPluginConfigurationReconciliation.js";

const unexpected = async (): Promise<never> => { throw new Error("unexpected read"); };
const input = (overrides: Partial<PluginConfigurationReadRepository>) => ({
  driver: {} as Driver,
  pluginConfigurationReadRepository: {
    listPluginSecretStatuses: unexpected,
    listInstalledPluginConfigs: unexpected,
    listReconciliationConfigs: unexpected,
    listReconciliationSecretStatuses: unexpected,
    ...overrides,
  },
});
const context = {} as GraphQLContext;
const info = {} as never;

test("secret statuses retain untested/valid/invalid mapping and omit stored values", async () => {
  const result = await getServerPluginSecrets(input({
    listPluginSecretStatuses: async (pluginId) => {
      assert.equal(pluginId, "scanner");
      return [
        { key: "untested", isValid: true, lastValidatedAt: null, validationError: null, ciphertext: "synthetic-secret" },
        { key: "valid", isValid: true, lastValidatedAt: "2026-01-01", validationError: null },
        { key: "invalid", isValid: false, lastValidatedAt: "2026-01-02", validationError: "Rejected" },
      ];
    },
  }))(null, { pluginId: "scanner" }, context, info);
  assert.deepEqual(result.map(({ status }) => status), ["SET_UNTESTED", "VALID", "INVALID"]);
  assert.equal(result[2].validationError, "Rejected");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|ciphertext/);
});

test("secret read failures retain resolver error prefix", async () => {
  await assert.rejects(getServerPluginSecrets(input({}))(null, { pluginId: "scanner" }, context, info), {
    message: "Failed to get server plugin secrets: unexpected read",
  });
});

test("installed plugins retain JSON decoding, defaults and best-effort registry comparisons", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ plugins: [{ id: "scanner", versions: [
      { version: "2.0.0", tarballUrl: "https://example.test/two", integritySha256: "hash" },
      { version: "1.0.0", tarballUrl: "https://example.test/one", integritySha256: "hash" },
    ] }] }), { status: 200 });
  });
  const resolver = getInstalledPlugins(input({ listInstalledPluginConfigs: async () => [{
    pluginRegistries: ["https://registry.example.test/index.json"],
    InstalledVersionsConnection: { edges: [{
      properties: { enabled: true, settingsJson: '{"setting":true}' },
      node: { version: "1.0.0", manifest: '{"name":"scanner"}', Plugin: { name: "scanner" } },
    }] },
  }] }));
  const result = await resolver(null, {}, context, info);
  assert.deepEqual(urls, ["https://registry.example.test/index.json"]);
  assert.deepEqual(result[0].settingsJson, { setting: true });
  assert.deepEqual(result[0].manifest, { name: "scanner" });
  assert.deepEqual(result[0].plugin.tags, []);
  assert.equal(result[0].hasUpdate, true);
  assert.equal(result[0].latestVersion, "2.0.0");
  assert.deepEqual(result[0].availableVersions, ["2.0.0", "1.0.0"]);
  assert.equal(result[0].scope, "SERVER");
});

test("registry failure retains installed data while invalid stored JSON still fails", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("registry offline"); });
  const configs = [{
    pluginRegistries: ["https://registry.example.test/index.json"],
    InstalledVersionsConnection: { edges: [{ properties: { settingsJson: "{}" }, node: { version: "1", Plugin: { name: "scanner" } } }] },
  }];
  const resolver = getInstalledPlugins(input({ listInstalledPluginConfigs: async () => configs }));
  assert.equal((await resolver(null, {}, context, info))[0].hasUpdate, false);
  configs[0].InstalledVersionsConnection.edges[0].properties.settingsJson = "{broken";
  await assert.rejects(resolver(null, {}, context, info), /Failed to get installed plugins:/);
});

test("empty installed configurations skip outbound registry calls", async (t) => {
  t.mock.method(globalThis, "fetch", unexpected);
  for (const configs of [[], [{ pluginRegistries: ["https://registry.example.test/index.json"] }]]) {
    assert.deepEqual(await getInstalledPlugins(input({ listInstalledPluginConfigs: async () => configs }))(null, {}, context, info), []);
  }
});

test("reconciliation missing config stops before reading secrets", async () => {
  const resolver = previewReconciliation(input({ listReconciliationConfigs: async () => [] }));
  await assert.rejects(resolver(null, { manifest: { apiVersion: "multiforum.gennit.dev/v1alpha1", plugins: [] } }, context, info), {
    message: "Server configuration not found",
  });
});
