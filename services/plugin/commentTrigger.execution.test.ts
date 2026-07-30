// Execution-path tests for the comment trigger: the per-plugin run lifecycle
// (PENDING -> RUNNING -> SUCCEEDED/FAILED/SKIPPED). The real plugin loader
// downloads and runs an untrusted tarball, so it is replaced via the injectable
// `loadPlugin` dependency with a fake in-memory plugin. Models are stubbed and
// the PluginRun create/update calls are captured to assert status transitions.
// No database or network.
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap } from "../../ogm_types.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import type {
  PluginConstructor,
  PluginRunResult,
} from "./pluginLoader.js";
import type { Driver } from "neo4j-driver";
import { triggerPluginRunsForComment } from "./commentTrigger.js";

type TriggerArgs = Parameters<typeof triggerPluginRunsForComment>[0];
type TriggerOptions = NonNullable<
  Parameters<typeof triggerPluginRunsForComment>[1]
>;
type Models = TriggerArgs["models"];
type LoadPlugin = NonNullable<TriggerOptions["loadPlugin"]>;
type RunCreateArgs = Parameters<ModelMap["PluginRun"]["create"]>[0];
type RunUpdateArgs = Parameters<ModelMap["PluginRun"]["update"]>[0];

const EVENT = "comment.created";

const discussionComment = () => ({
  id: "comment-1",
  text: "hello bot",
  botMentions: [],
  isFeedbackComment: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  CommentAuthor: { username: "alice", displayName: "Alice", isBot: false },
  DiscussionChannel: {
    id: "dc-1",
    discussionId: "d-1",
    channelUniqueName: "cats",
    Discussion: { id: "d-1", title: "T", body: "B" },
  },
  Channel: { uniqueName: "cats", displayName: "Cats", description: "", rules: [] },
  Event: null,
  Issue: null,
  ParentComment: null,
});

// An enabled, installed plugin version whose manifest handles comment.created.
const installedEdge = (name: string, manifestEvents: string[] = [EVENT]) => ({
  properties: { enabled: true, settingsJson: null },
  node: {
    id: `pv-${name}`,
    version: "1.0.0",
    repoUrl: null,
    tarballGsUri: `gs://bucket/${name}.tgz`,
    entryPath: "dist/index.js",
    manifest: JSON.stringify({ events: manifestEvents }),
    settingsDefaults: null,
    uiSchema: null,
    Plugin: { id: `p-${name}`, name, displayName: name, description: "", metadata: null },
  },
});

// Build stubbed models with a valid discussion comment, a channel with no
// channel-level settings, and a server config whose installed plugins are the
// given edges (no pipeline -> fallback runs all enabled plugins for the event).
function makeExecModels(edges: unknown[]) {
  const updates: RunUpdateArgs[] = [];
  const creates: RunCreateArgs[] = [];
  let seq = 0;
  const channel = {
    uniqueName: "cats",
    displayName: "Cats",
    description: "",
    rules: [],
    pluginPipelines: null,
    EnabledPluginsConnection: { edges: [] },
  };
  const serverConfig = {
    serverName: "s",
    pluginPipelines: null,
    InstalledVersionsConnection: { edges },
  };
  const PluginRun = modelStub<"PluginRun">({
    create: async args => {
      creates.push(args);
      seq += 1;
      return { pluginRuns: [{ id: `run-${seq}` }] };
    },
    update: async args => {
      updates.push(args);
      return {};
    },
    find: async ({ where } = {}) => [{ id: where?.id ?? "run-1" }],
  });
  const PluginPipelineRun = modelStub<"PluginPipelineRun">({
    find: async () => [],
    create: async args => ({
      pluginPipelineRuns: [{ id: 'attempt-1', ...args.input[0] }],
    }),
    update: async () => ({}),
  });
  const models = {
    Comment: modelStub<"Comment">({
      find: async () => [discussionComment()],
    }),
    Channel: modelStub<"Channel">({ find: async () => [channel] }),
    ServerConfig: modelStub<"ServerConfig">({
      find: async () => [serverConfig],
    }),
    ServerSecret: modelStub<"ServerSecret">(),
    PluginPipelineRun,
    PluginRun,
    Discussion: modelStub<"Discussion">(),
    Event: modelStub<"Event">(),
    Issue: modelStub<"Issue">(),
    User: modelStub<"User">(),
  } satisfies Models;
  return { models, updates, creates };
}

// A fake plugin class whose handleEvent returns/throws as configured.
const pluginReturning = (result: PluginRunResult): PluginConstructor =>
  class {
    constructor(..._args: unknown[]) {}
    async handleEvent() {
      return result;
    }
  };
const pluginThrowing = (message: string): PluginConstructor =>
  class {
    constructor(..._args: unknown[]) {}
    async handleEvent(): Promise<never> {
      throw new Error(message);
    }
  };
const loaderFor = (cls: PluginConstructor): LoadPlugin => async () => cls;

const execRun = (models: Models, loadPlugin: LoadPlugin) =>
  triggerPluginRunsForComment(
    {
      commentId: "comment-1",
      event: EVENT,
      models,
      driver: {} as Driver,
    },
    { loadPlugin }
  );

const statusesOf = (updates: RunUpdateArgs[]) =>
  updates.map(update => update.update?.status);

test("runs a matching plugin to SUCCEEDED", async () => {
  const { models, updates, creates } = makeExecModels([installedEdge("mybot")]);
  const runs = await execRun(models, loaderFor(pluginReturning({ success: true, result: { message: "ok" } })));

  assert.equal(creates.length, 1);
  assert.equal(creates[0].input[0].status, "PENDING");
  const statuses = statusesOf(updates);
  assert.ok(statuses.includes("RUNNING"), "transitions to RUNNING");
  assert.ok(statuses.includes("SUCCEEDED"), "ends SUCCEEDED");
  assert.ok(!statuses.includes("FAILED"));
  assert.equal(runs.length, 1);
});

test("marks the run FAILED when the plugin reports failure", async () => {
  const { models, updates } = makeExecModels([installedEdge("mybot")]);
  await execRun(models, loaderFor(pluginReturning({ success: false, error: "nope" })));
  assert.ok(statusesOf(updates).includes("FAILED"));
});

test("marks the run FAILED when the plugin throws", async () => {
  const { models, updates } = makeExecModels([installedEdge("mybot")]);
  await execRun(models, loaderFor(pluginThrowing("handle boom")));
  const failed = updates.find(update => update.update?.status === "FAILED");
  assert.ok(failed);
  assert.match(String(failed.update?.message), /handle boom/);
});

test("marks the run FAILED when the plugin fails to load", async () => {
  const { models, updates } = makeExecModels([installedEdge("mybot")]);
  const badLoader: LoadPlugin = async () => {
    throw new Error("load boom");
  };
  await execRun(models, badLoader);
  assert.ok(statusesOf(updates).includes("FAILED"));
});

test("skips later steps after a failure (stopOnFirstFailure)", async () => {
  const { models, updates } = makeExecModels([installedEdge("a"), installedEdge("b")]);
  let n = 0;
  const loader: LoadPlugin = async () => {
    n += 1;
    if (n === 1) throw new Error("load boom"); // first plugin fails to load
    return pluginReturning({ success: true }); // second would succeed, but is skipped
  };
  await execRun(models, loader);

  const statuses = statusesOf(updates);
  assert.ok(statuses.includes("FAILED"), "first plugin FAILED");
  const skipped = updates.find(update => update.update?.status === "SKIPPED");
  assert.ok(skipped, "second plugin SKIPPED");
  assert.match(String(skipped.update?.skippedReason), /Pipeline stopped/);
});
