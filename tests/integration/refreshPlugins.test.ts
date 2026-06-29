// Integration test for refreshPlugins against live Neo4j. This resolver reaches
// out to a plugin source over HTTP and now synthesizes registry entries from the
// GitHub Releases API, so we mock global fetch: the repo URL resolves to release
// metadata, the plugin.json asset provides the manifest, and the tarball/checksum
// assets are downloaded and verified against a real gzipped tar containing plugin.json.
// The DB writes (Plugin / PluginVersion nodes) run against the live container.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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

const REPO_URL = "https://github.com/gennit-project/test-plugin";
const RELEASES_API_URL = "https://api.github.com/repos/gennit-project/test-plugin/releases?per_page=100";
const TARBALL_URL = "https://github.com/gennit-project/test-plugin/releases/download/v1.0.0/test-plugin-1.0.0.tgz";
const MANIFEST_URL = "https://github.com/gennit-project/test-plugin/releases/download/v1.0.0/plugin.json";
const CHECKSUM_URL = "https://github.com/gennit-project/test-plugin/releases/download/v1.0.0/test-plugin-1.0.0.tgz.sha256";

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
let tarballSha256: string;

const installFetchMock = () => {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u === RELEASES_API_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ([
          {
            tag_name: "v1.0.0",
            html_url: "https://github.com/gennit-project/test-plugin/releases/tag/v1.0.0",
            target_commitish: "main",
            assets: [
              { name: "plugin.json", browser_download_url: MANIFEST_URL },
              { name: "test-plugin-1.0.0.tgz", browser_download_url: TARBALL_URL },
              { name: "test-plugin-1.0.0.tgz.sha256", browser_download_url: CHECKSUM_URL },
            ],
          },
        ]),
      };
    }
    if (u === MANIFEST_URL) {
      const manifest = {
        id: "test-plugin",
        version: "1.0.0",
        name: "Test Plugin",
        description: "A test plugin",
        entry: "index.js",
        metadata: { author: { name: "Alice" }, tags: ["util"] },
        source: { repoUrl: REPO_URL },
        compatibility: { minServerVersion: "1.0.0", apiVersion: "1" },
      };
      return {
        ok: true,
        status: 200,
        json: async () => manifest,
        text: async () => JSON.stringify(manifest),
      };
    }
    if (u === CHECKSUM_URL) {
      return {
        ok: true,
        status: 200,
        text: async () => `${tarballSha256}  test-plugin-1.0.0.tgz\n`,
      };
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
  tarballSha256 = crypto.createHash("sha256").update(tarball).digest("hex");
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
    { url: REPO_URL }
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
