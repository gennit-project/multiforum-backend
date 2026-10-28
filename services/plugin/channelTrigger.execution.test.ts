import {channelExecutionRepositoryStub} from "../../tests/fixtures/channelExecutionRepositoryStub.js";
import {pipelineAttemptRepositoryStub} from "../../tests/fixtures/pipelineAttemptRepositoryStub.js";
import {pipelineLeaseRepositoryStub} from "../../tests/fixtures/pipelineLeaseRepositoryStub.js";
// Execution-path tests for the channel trigger's per-plugin run lifecycle.
// The real plugin loader is replaced via the injectable `loadPlugin` dependency
// with a fake in-memory plugin; models are stubbed and PluginRun create/update
// calls captured to assert status transitions. No database or network.
import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { ModelMap } from "../../ogm_types.js";
import { PluginPipelineRunTrigger } from "../../ogm_types.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import type {
  PluginConstructor,
  PluginRunResult,
} from "./pluginLoader.js";
import { triggerChannelPluginPipeline as actualTrigger } from "./channelTrigger.js";

type TriggerArgs = Parameters<typeof triggerChannelPluginPipeline>[0];
type TriggerOptions = NonNullable<
  Parameters<typeof triggerChannelPluginPipeline>[1]
>;
type Models = import("./types.js").ChannelModels;
type LoadPlugin = NonNullable<TriggerOptions["loadPlugin"]>;
type RunCreateArgs = Parameters<ModelMap["PluginRun"]["create"]>[0];
type RunUpdateArgs = Parameters<ModelMap["PluginRun"]["update"]>[0];
type AttemptCreateArgs =
  Parameters<ModelMap["PluginPipelineRun"]["create"]>[0];
type FileUpdateArgs = Parameters<ModelMap["DownloadableFile"]["update"]>[0];

const EVENT = "discussionChannel.created";

const installedEdge = (name: string) => ({
  properties: { enabled: true, settingsJson: null as unknown },
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

function makeExecModels(
  steps: unknown[],
  edges: unknown[],
  serverPipelines: unknown[] = [],
  options: {
    discussion?: unknown
    discussionSnapshots?: unknown[]
    channelPluginEdges?: unknown[]
    serverRules?: string[]
  } = {}
) {
  const updates: RunUpdateArgs[] = [];
  const creates: RunCreateArgs[] = [];
  const attemptCreates: AttemptCreateArgs[] = [];
  const fileUpdates: FileUpdateArgs[] = [];
  let seq = 0;
  let discussionRead = 0;
  const channel = {
    uniqueName: "cats",
    displayName: "Cats",
    description: "",
    rules: [],
    pluginPipelines: [{ event: EVENT, steps }],
    Tags: [],
    FilterGroups: [],
    EnabledPluginsConnection: { edges: options.channelPluginEdges || [] },
  };
  const serverConfig = {
    serverName: "s",
    rules: options.serverRules || [],
    pluginPipelines: serverPipelines,
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
      find: async () => {
        const snapshots = options.discussionSnapshots || [options.discussion || discussionWithFile];
        return [snapshots[Math.min(discussionRead++, snapshots.length - 1)]];
      },
    }),
    ServerConfig: modelStub<"ServerConfig">({
      find: async () => [serverConfig],
    }),
    ServerSecret: modelStub<"ServerSecret">(),
    DownloadableFile: modelStub<"DownloadableFile">({
      update: async args => {
        fileUpdates.push(args);
        return { downloadableFiles: [] };
      },
    }),
    PluginPipelineRun,
    PluginRun,
    Plugin: modelStub<"Plugin">(),
    PluginVersion: modelStub<"PluginVersion">(),
  } satisfies Models;
  return { models, updates, creates, attemptCreates, fileUpdates };
}

const pluginReturning = (result: PluginRunResult): PluginConstructor =>
  class {
    constructor(..._args: unknown[]) {}
    async handleEvent() {
      return result;
    }
  };
const loaderFor = (cls: PluginConstructor): LoadPlugin => async () => cls;
// Terminal run updates flow through the generated v7 updateX mutation, so their
// scalar fields are wrapped as { set: value }; the in-memory repository stubs
// pass updates through verbatim (no setify), while flat extras (claim's RUNNING,
// skipped/rescheduled/cancelled runs) stay plain. setValue reads either shape.
const setValue = (value: unknown): unknown =>
  value && typeof value === "object" && "set" in (value as Record<string, unknown>)
    ? (value as { set: unknown }).set
    : value;
const statusesOf = (updates: RunUpdateArgs[]) =>
  updates.map(update => setValue(update.update?.status));

const execRun = (
  models: Models,
  loadPlugin: LoadPlugin,
  options: Omit<TriggerOptions, "loadPlugin"> = {}
) =>
  triggerChannelPluginPipeline(
    {
      driver: {} as Driver,
      discussionId: "d-1",
      channelUniqueName: "cats",
      event: EVENT,
      models,
    },
    { ...options, loadPlugin }
  );

test("runs a pipeline plugin to SUCCEEDED", async () => {
  const { models, updates, creates, attemptCreates } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );
  const runs = await execRun(models, loaderFor(pluginReturning({ success: true, result: { message: "ok" } })));

  assert.equal(creates.length, 1);
  assert.equal(creates[0].input[0].status, "PENDING");
  assert.match(String(creates[0].input[0].targetVersion), /^[a-f0-9]{64}$/);
  assert.match(String(creates[0].input[0].ruleSetVersion), /^[a-f0-9]{64}$/);
  assert.match(String(attemptCreates[0].input[0].targetVersion), /^[a-f0-9]{64}$/);
  const statuses = statusesOf(updates);
  assert.ok(statuses.includes("RUNNING"));
  assert.ok(statuses.includes("SUCCEEDED"));
  assert.equal(runs.length, 1);
});

test("enqueues a deferred discussion job without loading the plugin", async () => {
  const { models, updates, creates } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );
  let loadCount = 0;
  await execRun(models, async () => {
    loadCount += 1;
    return pluginReturning({ success: true });
  }, { execution: { deferExecution: true } });

  assert.deepEqual(
    {
      deferred: creates[0].input[0].deferred,
      status: creates[0].input[0].status,
      loadCount,
      runTransitions: statusesOf(updates).filter(Boolean),
    },
    {
      deferred: true,
      status: "PENDING",
      loadCount: 0,
      runTransitions: ["CANCELLED"],
    }
  );
});

test("resumes a persisted discussion job without creating a second attempt", async () => {
  const { models, updates, creates, attemptCreates } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );
  const loader = loaderFor(pluginReturning({ success: true, result: { message: "ok" } }));
  await execRun(models, loader, { execution: { deferExecution: true } });

  const queued = creates[0].input[0];
  await execRun(models, loader, {
    execution: {
      resume: {
        pipelineId: String(queued.pipelineId),
        targetVersion: String(queued.targetVersion),
        configurationSnapshot: attemptCreates[0].input[0].configurationSnapshot,
        maxRuns: 1,
        runs: [{
          id: "run-1",
          pluginId: String(queued.pluginId),
          order: Number(queued.executionOrder),
          status: "PENDING",
          version: String(queued.version),
          ruleSetVersion: String(queued.ruleSetVersion),
          targetVersion: String(queued.targetVersion),
        }],
      },
    },
  });

  assert.deepEqual(
    {
      attemptsCreated: attemptCreates.length,
      jobsCreated: creates.length,
      ran: statusesOf(updates).includes("RUNNING"),
      succeeded: statusesOf(updates).includes("SUCCEEDED"),
    },
    {
      attemptsCreated: 1,
      jobsCreated: 1,
      ran: true,
      succeeded: true,
    }
  );
});

test("reschedules a retryable persisted discussion job", async () => {
  const { models, updates, creates, attemptCreates } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );
  const loader = loaderFor(pluginReturning({
    success: false,
    error: "service unavailable",
    retryable: true,
  }));
  await execRun(models, loader, { execution: { deferExecution: true } });

  const queued = creates[0].input[0];
  await execRun(models, loader, {
    execution: {
      resume: {
        pipelineId: String(queued.pipelineId),
        targetVersion: String(queued.targetVersion),
        configurationSnapshot: attemptCreates[0].input[0].configurationSnapshot,
        maxRuns: 1,
        runs: [{
          id: "run-1",
          pluginId: String(queued.pluginId),
          order: Number(queued.executionOrder),
          status: "PENDING",
          version: String(queued.version),
          ruleSetVersion: String(queued.ruleSetVersion),
          targetVersion: String(queued.targetVersion),
          retryCount: 0,
        }],
      },
    },
  });

  const rescheduled = updates.find(update => update.update?.retryCount === 1);
  assert.equal(attemptCreates.length, 1);
  assert.equal(creates.length, 1);
  assert.equal(rescheduled?.update?.status, "PENDING");
  assert.match(String(rescheduled?.update?.message), /retry 1\/3 scheduled/);
  assert.ok(Number.isFinite(Date.parse(String(rescheduled?.update?.nextAttemptAt))));
  assert.ok(!statusesOf(updates).includes("FAILED"));
});

test("does not publish a stale discussion verdict when an edit lands during execution", async () => {
  const { models } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")],
    [],
    {
      discussionSnapshots: [
        discussionWithFile,
        { ...discussionWithFile, body: "newer body" },
      ],
    }
  );
  let reports = 0;
  const Plugin: PluginConstructor = class {
    private readonly context: Record<string, any>;
    constructor(context: unknown) {
      this.context = context as Record<string, any>;
    }
    async handleEvent() {
      await this.context.reportContentAsBot({
        contentType: "discussion",
        contentId: "d-1",
        reportText: "stale verdict",
        selectedForumRules: [],
        selectedServerRules: [],
        botName: "moderator",
      });
      return { success: true };
    }
  };

  await execRun(models, loaderFor(Plugin), {
    reportAsBot: async () => {
      reports += 1;
      return { id: "issue-1" } as never;
    },
  });

  assert.equal(reports, 0);
});

test("runs discussion moderation without an attachment and supplies rule context", async () => {
  const edge = installedEdge("mybot");
  edge.properties.settingsJson = { mode: "report" };
  const { models, creates, fileUpdates } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [edge],
    [],
    {
      discussion: {
        id: "d-1",
        title: "Text discussion",
        body: "Please review this post",
        Author: { username: "alice", isBot: false },
        DownloadableFile: null,
      },
      channelPluginEdges: [edge],
      serverRules: ["Be kind"],
    }
  );
  const receivedContexts: Array<Record<string, any>> = [];
  const receivedEvents: Array<Record<string, any>> = [];
  const Plugin: PluginConstructor = class {
    constructor(...args: unknown[]) {
      receivedContexts.push(args[0] as Record<string, any>);
    }
    async handleEvent(event: unknown) {
      receivedEvents.push(event as Record<string, any>);
      return { success: true };
    }
  };

  await execRun(models, loaderFor(Plugin));

  assert.equal(creates.length, 1);
  assert.deepEqual(fileUpdates, []);
  assert.equal(typeof receivedContexts[0]?.reportContentAsBot, "function");
  assert.deepEqual(receivedEvents[0]?.payload?.author, {
    username: "alice",
    isBot: false,
  });
  assert.deepEqual(receivedEvents[0]?.payload?.attachmentUrls, []);
  assert.deepEqual(receivedEvents[0]?.payload?.context?.server?.rules, ["Be kind"]);
  assert.equal(receivedEvents[0]?.payload?.context?.channel?.pluginEnabled, true);
});

test("deduplicates a plugin selected by both server and channel pipelines", async () => {
  const edge = installedEdge("mybot");
  const { models, creates } = makeExecModels(
    [{ pluginId: "mybot", version: "1.0.0", condition: "ALWAYS" }],
    [edge],
    [{ event: EVENT, steps: [{ pluginId: "mybot", condition: "ALWAYS" }] }]
  );

  await execRun(models, loaderFor(pluginReturning({ success: true })));

  assert.equal(creates.length, 1);
});

test("reports a discussion with the channel-scoped bot identity", async () => {
  const { models } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );
  const suspensionChecks: Array<Record<string, unknown>> = [];
  const reports: Array<Record<string, any>> = [];
  const Plugin: PluginConstructor = class {
    private readonly context: Record<string, any>;
    constructor(...args: unknown[]) {
      this.context = args[0] as Record<string, any>;
    }
    async handleEvent() {
      await this.context.reportContentAsBot({
        contentType: "discussion",
        contentId: "d-1",
        reportText: "Rule violation",
        selectedForumRules: ["Be kind"],
        selectedServerRules: [],
        botName: "moderator",
        profileId: "primary",
        recommendedAction: "remove",
        recommendationConfidence: 0.93,
        recommendationRationale: "The discussion should be removed.",
      });
      return { success: true };
    }
  };

  await execRun(models, loaderFor(Plugin), {
    getSuspension: async input => {
      suspensionChecks.push(input as unknown as Record<string, unknown>);
      return {
        activeSuspension: null,
        isSuspended: false,
        relatedIssueId: null,
        relatedIssueNumber: null,
        expiredUserSuspensions: [],
        expiredModSuspensions: [],
        suspendedEntity: null,
      };
    },
    reportAsBot: async input => {
      reports.push(input as unknown as Record<string, any>);
      return { id: "issue-1" } as never;
    },
  });

  assert.equal(suspensionChecks[0]?.channelUniqueName, "cats");
  assert.equal(suspensionChecks[0]?.username, "bot-cats-moderator-primary");
  assert.deepEqual(reports[0]?.channelUniqueName, "cats");
  assert.deepEqual(reports[0]?.reportInput, {
    contentType: "discussion",
    contentId: "d-1",
    reportText: "Rule violation",
    selectedForumRules: ["Be kind"],
    selectedServerRules: [],
    botName: "moderator",
    profileId: "primary",
    recommendedAction: "remove",
    recommendationConfidence: 0.93,
    recommendationRationale: "The discussion should be removed.",
  });
  assert.match(
    reports[0]?.idempotencyKey,
    /^bot-report:v1:[a-f0-9]{64}$/
  );
});

test("blocks reports from a suspended channel bot", async () => {
  const { models } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );
  let reportCalls = 0;
  const Plugin: PluginConstructor = class {
    private readonly context: Record<string, any>;
    constructor(...args: unknown[]) {
      this.context = args[0] as Record<string, any>;
    }
    async handleEvent() {
      const report = await this.context.reportContentAsBot({
        contentType: "discussion",
        contentId: "d-1",
        reportText: "Rule violation",
        selectedForumRules: ["Be kind"],
        selectedServerRules: [],
        botName: "moderator",
      });
      assert.equal(report, null);
      return { success: true };
    }
  };

  await execRun(models, loaderFor(Plugin), {
    getSuspension: async () => ({
      activeSuspension: {} as never,
      isSuspended: true,
      relatedIssueId: "issue-1",
      relatedIssueNumber: 1,
      expiredUserSuspensions: [],
      expiredModSuspensions: [],
      suspendedEntity: "user",
    }),
    reportAsBot: async () => {
      reportCalls += 1;
      return {} as never;
    },
  });

  assert.equal(reportCalls, 0);
});

test("marks the run FAILED when the plugin reports failure", async () => {
  const { models, updates } = makeExecModels(
    [{ pluginId: "mybot", condition: "ALWAYS" }],
    [installedEdge("mybot")]
  );
  await execRun(models, loaderFor(pluginReturning({ success: false, error: "nope" })));
  assert.ok(statusesOf(updates).includes("FAILED"));
});

test("channel security scans receive the attachment and update the hold", async () => {
  const { models, fileUpdates } = makeExecModels(
    [{ pluginId: "security-attachment-scan", condition: "ALWAYS" }],
    [installedEdge("security-attachment-scan")]
  );
  let receivedUrls: string[] = [];
  const Plugin: PluginConstructor = class {
    constructor(..._args: unknown[]) {}
    async handleEvent(event: unknown) {
      const envelope = event as { payload?: { attachmentUrls?: string[] } };
      receivedUrls = envelope.payload?.attachmentUrls || [];
      return { success: true, result: { verdict: "clean", message: "Passed" } };
    }
  };

  await execRun(models, loaderFor(Plugin));

  assert.deepEqual({
    receivedUrls,
    statuses: fileUpdates.map(update => update.update?.scanStatus),
  }, {
    receivedUrls: ["http://x/a.zip"],
    statuses: ["PENDING", "CLEAN"],
  });
});

test("server-wide security policy prevents a duplicate channel scan", async () => {
  const { models, creates, fileUpdates } = makeExecModels(
    [{ pluginId: "security-attachment-scan", condition: "ALWAYS" }],
    [installedEdge("security-attachment-scan")],
    [{
      event: "downloadableFile.created",
      steps: [{ pluginId: "security-attachment-scan" }],
    }]
  );

  const runs = await execRun(
    models,
    loaderFor(pluginReturning({ success: true }))
  );

  assert.deepEqual({ runs, creates: creates.length, fileUpdates }, {
    runs: [],
    creates: 0,
    fileUpdates: [],
  });
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

const triggerChannelPluginPipeline = (args: Parameters<typeof actualTrigger>[0] & { models: Models }, options?: Parameters<typeof actualTrigger>[1]) => {const {models, ...rest} = args; return actualTrigger(rest,{...options,channelRepository:channelExecutionRepositoryStub(models),leaseRepository:pipelineLeaseRepositoryStub(models),attemptRepository:pipelineAttemptRepositoryStub(models.PluginPipelineRun)});};
