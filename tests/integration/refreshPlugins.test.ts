// Integration test for refreshPlugins against live Neo4j. This resolver reaches
// out to a plugin registry over HTTP and downloads each plugin's tarball to read
// its manifest, so we mock global fetch: the registry URL returns registry JSON,
// and each tarball URL returns a real gzipped tar containing plugin.json. The DB
// writes (Plugin / PluginVersion nodes) run against the live container.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import tar from "tar-stream";
import { gzipSync } from "zlib";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;
const originalFetch = globalThis.fetch;

const REGISTRY_URL = "https://registry.test/registry.json";
const TARBALL_URL = "https://registry.test/test-plugin-1.0.0.tgz";

const buildTarball = (manifest: object): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const pack = tar.pack();
    pack.entry({ name: "plugin.json" }, JSON.stringify(manifest), (err) => {
      if (err) reject(err);
      else pack.finalize();
    });
    const chunks: Buffer[] = [];
    pack.on("data", (c) => chunks.push(c as Buffer));
    pack.on("end", () => resolve(gzipSync(Buffer.concat(chunks))));
    pack.on("error", reject);
  });

let tarball: Buffer;

const registryJson = {
  updatedAt: "2026-01-01T00:00:00Z",
  plugins: [
    {
      id: "test-plugin",
      versions: [
        {
          version: "1.0.0",
          tarballUrl: TARBALL_URL,
          integritySha256: "deadbeef",
        },
      ],
    },
  ],
};

const installFetchMock = () => {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u === REGISTRY_URL) {
      return { ok: true, status: 200, json: async () => registryJson };
    }
    if (u === TARBALL_URL) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          tarball.buffer.slice(
            tarball.byteOffset,
            tarball.byteOffset + tarball.byteLength
          ),
      };
    }
    throw new Error(`Unexpected fetch in test: ${u}`);
  }) as any;
};

before(async () => {
  env = await startImageModEnv();
  tarball = await buildTarball({
    id: "test-plugin",
    version: "1.0.0",
    name: "Test Plugin",
    description: "A test plugin",
    entry: "index.js",
    metadata: { author: { name: "Alice" }, tags: ["util"] },
  });
}, { timeout: 240000 });

after(async () => {
  globalThis.fetch = originalFetch;
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  installFetchMock();
});

const refreshPlugins = () =>
  env.resolvers.Mutation.refreshPlugins(null, {}, {});

test("creates Plugin + PluginVersion from the registry and tarball manifest", async () => {
  await run(
    `CREATE (:ServerConfig { serverName: 'test-server', pluginRegistries: [$url] })`,
    { url: REGISTRY_URL }
  );

  await refreshPlugins();

  const plugins = await run(
    `MATCH (p:Plugin { name: 'test-plugin' })
     RETURN p.displayName AS displayName, p.authorName AS authorName`
  );
  assert.equal(plugins.length, 1, "plugin should be created");
  assert.equal(plugins[0].displayName, "Test Plugin");

  const versions = await run(
    `MATCH (:Plugin { name: 'test-plugin' })-[:HAS_VERSION]->(pv:PluginVersion)
     RETURN pv.version AS version, pv.repoUrl AS repoUrl`
  );
  assert.equal(versions.length, 1, "plugin version should be created and connected");
  assert.equal(versions[0].version, "1.0.0");
  assert.equal(versions[0].repoUrl, TARBALL_URL);
});

test("throws when no plugin registries are configured", async () => {
  await run(`CREATE (:ServerConfig { serverName: 'test-server' })`);
  await assert.rejects(refreshPlugins(), /No plugin registries configured/i);
});
