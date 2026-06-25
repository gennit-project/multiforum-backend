// Execution-path tests for the channel trigger's per-plugin run lifecycle.
// The real plugin loader is replaced via the injectable `loadPlugin` dependency
// with a fake in-memory plugin; models are stubbed and PluginRun create/update
// calls captured to assert status transitions. No database or network.
import assert from "node:assert/strict";
import test from "node:test";
import { triggerChannelPluginPipeline } from "./channelTrigger.js";

const EVENT = "discussionChannel.created";

const model = (rows: unknown[]) => ({ find: async () => rows });
const empty = () => model([]);

const installedEdge = (name: string) => ({
  properties: { enabled: true, settingsJson: null },
  node: {
    id: `pv-${name}`,
    version: "1.0.0",
    repoUrl: null,
    tarballGsUri: `gs://bucket/${name}.tgz`,
    entryPath: "dist/index.js",
    manifest: JSON.stringify({ events: [EVENT] }),
    settingsDefaults: null,
    uiSchema: null,
    Plugin: { id: `p-${name}`, name, displayName: name, description: "", metadata: null },
  },
});

const discussionWithFile = {
  id: "d-1",
  title: "T",
  body: "B",
  DownloadableFile: { id: "f-1", fileName: "a.zip", url: "http://x/a.zip", kind: "zip", size: 10 },
};

function makeExecModels(steps: unknown[], edges: unknown[]) {
  const updates: any[] = [];
  const creates: any[] = [];
  let seq = 0;
  const channel = {
    uniqueName: "cats",
    displayName: "Cats",
    description: "",
    rules: [],
    pluginPipelines: [{ event: EVENT, steps }],
    Tags: [],
    FilterGroups: [],
    EnabledPluginsConnection: { edges: [] },
  };
  const serverConfig = { serverName: "s", InstalledVersionsConnection: { edges } };
  const PluginRun = {
    create: async (args: any) => {
      creates.push(args);
      seq += 1;
      return { pluginRuns: [{ id: `run-${seq}` }] };
    },
    update: async (args: any) => {
      updates.push(args);
      return {};
    },
    find: async (args: any) => [{ id: args?.where?.id ?? "run-1" }],
  };
  const models: any = {
    Channel: model([channel]),
    Discussion: model([discussionWithFile]),
    ServerConfig: model([serverConfig]),
    ServerSecret: empty(),
    DownloadableFile: empty(),
    PluginRun,
    Plugin: empty(),
    PluginVersion: empty(),
  };
  return { models, updates, creates };
}

const pluginReturning = (result: unknown) =>
  class {
    constructor(public ctx: unknown) {}
    async handleEvent() {
      return result;
    }
  };
const loaderFor = (cls: unknown) => (async () => cls) as any;
const statusesOf = (updates: any[]) => updates.map((u) => u.update.status);

const execRun = (models: any, loadPlugin: any) =>
  triggerChannelPluginPipeline(
    { discussionId: "d-1", channelUniqueName: "cats", event: EVENT, models },
    { loadPlugin }
  );

test("runs a pipeline plugin to SUCCEEDED", async () => {
  const { models, updates, creates } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );
  const runs = await execRun(models, loaderFor(pluginReturning({ success: true, result: { message: "ok" } })));

  assert.equal(creates.length, 1);
  assert.equal(creates[0].input[0].status, "PENDING");
  const statuses = statusesOf(updates);
  assert.ok(statuses.includes("RUNNING"));
  assert.ok(statuses.includes("SUCCEEDED"));
  assert.equal(runs.length, 1);
});

test("marks the run FAILED when the plugin reports failure", async () => {
  const { models, updates } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );
  await execRun(models, loaderFor(pluginReturning({ success: false, error: "nope" })));
  assert.ok(statusesOf(updates).includes("FAILED"));
});

test("skips later steps after a failure (stopOnFirstFailure)", async () => {
  const { models, updates } = makeExecModels(
    [
      { pluginId: "a", condition: "ALWAYS" },
      { pluginId: "b", condition: "ALWAYS" },
    ],
    [installedEdge("a"), installedEdge("b")]
  );
  let n = 0;
  const loader = (async () => {
    n += 1;
    if (n === 1) throw new Error("load boom");
    return pluginReturning({ success: true });
  }) as any;
  await execRun(models, loader);

  const statuses = statusesOf(updates);
  assert.ok(statuses.includes("FAILED"));
  assert.ok(statuses.includes("SKIPPED"));
});
