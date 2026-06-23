// Integration test for installPluginVersion against live Neo4j. Like
// refreshPlugins it fetches a registry and downloads the plugin tarball (mocked
// via global fetch), but it also verifies the tarball's SHA-256 against the
// registry, then installs the version onto the ServerConfig (INSTALLED edge).

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import tar from "tar-stream";
import { gzipSync } from "zlib";
import crypto from "crypto";
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
let registryJson: any;
let correctSha: string;

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
    entry: "index.js",
    metadata: { author: { name: "Alice" } },
  });
  correctSha = crypto.createHash("sha256").update(tarball).digest("hex");
  registryJson = {
    updatedAt: "2026-01-01T00:00:00Z",
    plugins: [
      {
        id: "test-plugin",
        versions: [
          { version: "1.0.0", tarballUrl: TARBALL_URL, integritySha256: correctSha },
        ],
      },
    ],
  };
}, { timeout: 240000 });

after(async () => {
  globalThis.fetch = originalFetch;
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  registryJson.plugins[0].versions[0].integritySha256 = correctSha; // reset after the mismatch test
  installFetchMock();
});

const installPluginVersion = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.installPluginVersion(null, args, {});

test("installs a plugin version onto the server config", async () => {
  await run(
    `CREATE (:ServerConfig { serverName: 'test-server', pluginRegistries: [$url] })`,
    { url: REGISTRY_URL }
  );

  await installPluginVersion({ pluginId: "test-plugin", version: "1.0.0" });

  const versions = await run(
    `MATCH (:Plugin { name: 'test-plugin' })-[:HAS_VERSION]->(pv:PluginVersion { version: '1.0.0' })
     RETURN pv.id AS id`
  );
  assert.equal(versions.length, 1, "plugin version should be created");

  const installed = await run(
    `MATCH (:ServerConfig { serverName: 'test-server' })-[r:INSTALLED]->(:PluginVersion { version: '1.0.0' })
     RETURN r.enabled AS enabled`
  );
  assert.equal(installed.length, 1, "version should be installed on the server");
  assert.equal(installed[0].enabled, false, "newly installed version starts disabled");
});

test("rejects when the tarball SHA-256 does not match the registry", async () => {
  registryJson.plugins[0].versions[0].integritySha256 = "0".repeat(64);
  await run(
    `CREATE (:ServerConfig { serverName: 'test-server', pluginRegistries: [$url] })`,
    { url: REGISTRY_URL }
  );
  await assert.rejects(
    installPluginVersion({ pluginId: "test-plugin", version: "1.0.0" }),
    /integrity verification failed|SHA-256 mismatch/i
  );
});
