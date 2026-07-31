// Execution-path tests for the channel trigger's per-plugin run lifecycle.
// The real plugin loader is replaced via the injectable `loadPlugin` dependency
// with a fake in-memory plugin; models are stubbed and PluginRun create/update
// calls captured to assert status transitions. No database or network.
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap } from "../../ogm_types.js";
import { PluginPipelineRunTrigger } from "../../ogm_types.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import type {
  PluginConstructor,
  PluginRunResult,
} from "./pluginLoader.js";
import { triggerChannelPluginPipeline } from "./channelTrigger.js";

type TriggerArgs = Parameters<typeof triggerChannelPluginPipeline>[0];
type TriggerOptions = NonNullable<
  Parameters<typeof triggerChannelPluginPipeline>[1]
>;
type Models = TriggerArgs["models"];
type LoadPlugin = NonNullable<TriggerOptions["loadPlugin"]>;
type RunCreateArgs = Parameters<ModelMap["PluginRun"]["create"]>[0];
type RunUpdateArgs = Parameters<ModelMap["PluginRun"]["update"]>[0];
type AttemptCreateArgs =
  Parameters<ModelMap["PluginPipelineRun"]["create"]>[0];

const EVENT = "discussionChannel.created";

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
  const updates: RunUpdateArgs[] = [];
  const creates: RunCreateArgs[] = [];
  const attemptCreates: AttemptCreateArgs[] = [];
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
  const PluginRun = modelStub<"PluginRun">({
    create: async args => {
      creates.push(args);
      seq += 1;
      return { pluginRuns: [{ id: `run-${seq}` }] };
    },
    update: async args => {
      updates.push(args);
      return { pluginRuns: [{ id: "run-1" }] };
    },
    find: async ({ where } = {}) => [{ id: where?.id ?? "run-1" }],
  });
  const PluginPipelineRun = modelStub<"PluginPipelineRun">({
    find: async () => [],
    create: async args => {
      attemptCreates.push(args);
      return {
        pluginPipelineRuns: [{ id: 'attempt-1', ...args.input[0] }],
      };
    },
    update: async () => ({}),
  });
  const models = {
    Channel: modelStub<"Channel">({ find: async () => [channel] }),
    Discussion: modelStub<"Discussion">({
      find: async () => [discussionWithFile],
    }),
    ServerConfig: modelStub<"ServerConfig">({
      find: async () => [serverConfig],
    }),
    ServerSecret: modelStub<"ServerSecret">(),
    DownloadableFile: modelStub<"DownloadableFile">(),
    PluginPipelineRun,
    PluginRun,
    Plugin: modelStub<"Plugin">(),
    PluginVersion: modelStub<"PluginVersion">(),
  } satisfies Models;
  return { models, updates, creates, attemptCreates };
}

const pluginReturning = (result: PluginRunResult): PluginConstructor =>
  class {
    constructor(..._args: unknown[]) {}
    async handleEvent() {
      return result;
    }
  };
const loaderFor = (cls: PluginConstructor): LoadPlugin => async () => cls;
const statusesOf = (updates: RunUpdateArgs[]) =>
  updates.map(update => update.update?.status);

const execRun = (models: Models, loadPlugin: LoadPlugin) =>
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

test("records channel manual-start metadata supplied by the caller", async () => {
  const { models, attemptCreates } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );

  await triggerChannelPluginPipeline(
    {
      discussionId: "d-1",
      channelUniqueName: "cats",
      event: EVENT,
      models,
    },
    {
      loadPlugin: loaderFor(
        pluginReturning({ success: true, result: { message: "ok" } })
      ),
      execution: {
        pipelineId: "manual-channel-pipeline",
        trigger: PluginPipelineRunTrigger.ModeratorStart,
        initiatedByUsername: "moderator",
        retryOfPipelineRunId: "previous-channel-pipeline",
      },
    }
  );

  assert.deepEqual(
    {
      pipelineId: attemptCreates[0].input[0].pipelineId,
      trigger: attemptCreates[0].input[0].trigger,
      actor: attemptCreates[0].input[0].initiatedByUsername,
      retryOf: attemptCreates[0].input[0].retryOfPipelineRunId,
    },
    {
      pipelineId: "manual-channel-pipeline",
      trigger: "MODERATOR_START",
      actor: "moderator",
      retryOf: "previous-channel-pipeline",
    }
  );
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
  const loader: LoadPlugin = async () => {
    n += 1;
    if (n === 1) throw new Error("load boom");
    return pluginReturning({ success: true });
  };
  await execRun(models, loader);

  const statuses = statusesOf(updates);
  assert.ok(statuses.includes("FAILED"));
  assert.ok(statuses.includes("SKIPPED"));
});
