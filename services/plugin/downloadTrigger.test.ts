// Unit tests for the downloadable-file plugin trigger's decision logic: which
// download events trigger plugin runs and how the server pipeline / enabled
// plugins are selected. These drive triggerPluginRunsForDownloadableFile through
// its guards and selection branches with stubbed OGM models (no DB), stopping
// before the live plugin-execution path.
import assert from "node:assert/strict";
import test from "node:test";
import {
  isSupportedEvent,
  triggerPluginRunsForDownloadableFile,
} from "./downloadTrigger.js";

const EVENT = "downloadableFile.created";

const model = (rows: unknown[]) => ({ find: async () => rows });
const empty = () => model([]);

function makeModels(opts: {
  file?: unknown | null;
  serverConfig?: unknown | null;
} = {}): any {
  return {
    DownloadableFile: model(opts.file ? [opts.file] : []),
    ServerConfig: model(opts.serverConfig ? [opts.serverConfig] : []),
    Plugin: empty(),
    PluginVersion: empty(),
    PluginRun: empty(),
    ServerSecret: empty(),
  };
}

const fileNode = {
  id: "f-1",
  fileName: "a.zip",
  url: "http://x/a.zip",
  kind: "zip",
  size: 10,
  Discussion: null,
};

const installedPlugin = (manifestEvents: string[]) => ({
  properties: { enabled: true, settingsJson: null },
  node: {
    id: "pv-1",
    version: "1.0.0",
    manifest: JSON.stringify({ events: manifestEvents }),
    Plugin: { id: "p-1", name: "scanner" },
  },
});

const run = (models: any, event = EVENT) =>
  triggerPluginRunsForDownloadableFile({ downloadableFileId: "f-1", event, models });

test("isSupportedEvent recognizes the download events only", () => {
  assert.equal(isSupportedEvent("downloadableFile.created"), true);
  assert.equal(isSupportedEvent("downloadableFile.downloaded"), true);
  assert.equal(isSupportedEvent("comment.created"), false);
});

test("throws on an unsupported event", async () => {
  await assert.rejects(run(makeModels(), "downloadableFile.archived"), /Unsupported plugin event/);
});

test("throws when the downloadable file does not exist", async () => {
  await assert.rejects(run(makeModels({ file: null })), /Downloadable file not found/);
});

test("returns [] when there is no server config", async () => {
  assert.deepEqual(await run(makeModels({ file: fileNode, serverConfig: null })), []);
});

test("returns [] when no plugins are installed (fallback path)", async () => {
  const serverConfig = {
    serverName: "s",
    pluginPipelines: null,
    InstalledVersionsConnection: { edges: [] },
  };
  assert.deepEqual(await run(makeModels({ file: fileNode, serverConfig })), []);
});

test("returns [] when an installed plugin does not handle the event", async () => {
  const serverConfig = {
    serverName: "s",
    pluginPipelines: null,
    InstalledVersionsConnection: { edges: [installedPlugin(["comment.created"])] },
  };
  assert.deepEqual(await run(makeModels({ file: fileNode, serverConfig })), []);
});

test("returns [] when a pipeline step references an uninstalled plugin", async () => {
  const serverConfig = {
    serverName: "s",
    pluginPipelines: [{ event: EVENT, steps: [{ pluginId: "ghost", condition: "ALWAYS" }] }],
    InstalledVersionsConnection: { edges: [] },
  };
  assert.deepEqual(await run(makeModels({ file: fileNode, serverConfig })), []);
});
