import {commentExecutionRepositoryStub} from "../../tests/fixtures/commentExecutionRepositoryStub.js";
import {pipelineAttemptRepositoryStub} from "../../tests/fixtures/pipelineAttemptRepositoryStub.js";
import {pipelineLeaseRepositoryStub} from "../../tests/fixtures/pipelineLeaseRepositoryStub.js";
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
import { triggerPluginRunsForComment as actualTrigger } from "./commentTrigger.js";

type TriggerOptions = NonNullable<
  Parameters<typeof actualTrigger>[1]
>;
type Models = Pick<
  ModelMap,
  | "Channel"
  | "Comment"
  | "ServerConfig"
  | "ServerSecret"
  | "PluginPipelineRun"
  | "PluginRun"
  | "Discussion"
  | "Event"
  | "Issue"
  | "User"
>;
type LoadPlugin = NonNullable<TriggerOptions["loadPlugin"]>;
type RunCreateArgs = Parameters<ModelMap["PluginRun"]["create"]>[0];
type RunUpdateArgs = Parameters<ModelMap["PluginRun"]["update"]>[0];
type AttemptCreateArgs =
  Parameters<ModelMap["PluginPipelineRun"]["create"]>[0];

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
function makeExecModels(
  edges: unknown[],
  {
    channelRules = [],
    channelPluginEdges = [],
    commentSnapshots = [discussionComment()],
    unclaimableStatus,
  }: {
    channelRules?: string[];
    channelPluginEdges?: unknown[];
    commentSnapshots?: ReturnType<typeof discussionComment>[];
    unclaimableStatus?: string;
  } = {}
) {
  const updates: RunUpdateArgs[] = [];
  const creates: RunCreateArgs[] = [];
  const attemptCreates: AttemptCreateArgs[] = [];
  let seq = 0;
  let commentRead = 0;
  const channel = {
    uniqueName: "cats",
    displayName: "Cats",
    description: "",
    rules: channelRules,
    pluginPipelines: null,
    EnabledPluginsConnection: { edges: channelPluginEdges },
  };
  const serverConfig = {
    serverName: "s",
    rules: ["No spam", "No threats"],
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
      if (args.where?.id && args.where?.status === "PENDING" && unclaimableStatus) {
        return { pluginRuns: [] };
      }
      return { pluginRuns: [{ id: "run-1" }] };
    },
    find: async ({ where } = {}) => [{
      id: where?.id ?? "run-1",
      ...(unclaimableStatus ? { status: unclaimableStatus } : {}),
    }],
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
    Comment: modelStub<"Comment">({
      find: async () => [
        commentSnapshots[Math.min(commentRead++, commentSnapshots.length - 1)]!,
      ],
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
  return { models, updates, creates, attemptCreates };
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

const execRun = (
  models: Models,
  loadPlugin: LoadPlugin,
  event = EVENT,
  options: Omit<TriggerOptions, "loadPlugin"> = {}
) =>
  triggerPluginRunsForComment(
    {
      commentId: "comment-1",
      event,
      driver: {} as Driver,
    },
    models,
    { ...options, loadPlugin }
  );

const statusesOf = (updates: RunUpdateArgs[]) =>
  updates.map(update => update.update?.status);

test("runs a matching plugin to SUCCEEDED", async () => {
  const { models, updates, creates, attemptCreates } = makeExecModels([installedEdge("mybot")]);
  const runs = await execRun(models, loaderFor(pluginReturning({ success: true, result: { message: "ok" } })));

  assert.equal(creates.length, 1);
  assert.equal(creates[0].input[0].status, "PENDING");
  assert.match(String(creates[0].input[0].targetVersion), /^[a-f0-9]{64}$/);
  assert.match(String(creates[0].input[0].ruleSetVersion), /^[a-f0-9]{64}$/);
  assert.match(String(attemptCreates[0].input[0].targetVersion), /^[a-f0-9]{64}$/);
  const statuses = statusesOf(updates);
  assert.ok(statuses.includes("RUNNING"), "transitions to RUNNING");
  assert.ok(statuses.includes("SUCCEEDED"), "ends SUCCEEDED");
  assert.ok(!statuses.includes("FAILED"));
  assert.equal(runs.length, 1);
});

test("does not publish a stale comment verdict when an edit lands during execution", async () => {
  const original = discussionComment();
  const edited = { ...discussionComment(), text: "newer text" };
  const { models } = makeExecModels([installedEdge("mybot")], {
    commentSnapshots: [original, edited],
  });
  let reports = 0;
  const Plugin: PluginConstructor = class {
    private readonly context: Record<string, any>;
    constructor(context: unknown) {
      this.context = context as Record<string, any>;
    }
    async handleEvent() {
      await this.context.reportContentAsBot({
        contentType: "comment",
        contentId: "comment-1",
        reportText: "stale verdict",
        selectedForumRules: [],
        selectedServerRules: [],
        botName: "moderator",
      });
      return { success: true };
    }
  };

  await execRun(models, loaderFor(Plugin), EVENT, {
    reportAsBot: async () => {
      reports += 1;
      return { issueId: "issue-1", issueNumber: 1 };
    },
  });

  assert.equal(reports, 0);
});

test("returns a job cancelled by a newer enqueue without executing it", async () => {
  const { models } = makeExecModels([installedEdge("mybot")], {
    unclaimableStatus: "CANCELLED",
  });
  let loads = 0;

  const runs = await execRun(models, async () => {
    loads += 1;
    return pluginReturning({ success: true });
  });

  assert.equal(loads, 0);
  assert.equal((runs[0] as { status?: string })?.status, "CANCELLED");
});

test("supplies an internal replay key when a plugin reports a comment", async () => {
  const { models } = makeExecModels([installedEdge("mybot")]);
  const reports: Array<Record<string, any>> = [];
  const Plugin: PluginConstructor = class {
    private readonly context: Record<string, any>;
    constructor(context: unknown) {
      this.context = context as Record<string, any>;
    }
    async handleEvent() {
      await this.context.reportContentAsBot({
        contentType: "comment",
        contentId: "comment-1",
        reportText: "Rule violation",
        selectedForumRules: ["Be kind"],
        selectedServerRules: [],
        botName: "moderator",
      });
      return { success: true };
    }
  };

  await execRun(models, loaderFor(Plugin), EVENT, {
    getSuspension: async () => ({
      activeSuspension: null,
      isSuspended: false,
      relatedIssueId: null,
      relatedIssueNumber: null,
      expiredUserSuspensions: [],
      expiredModSuspensions: [],
      suspendedEntity: null,
    }),
    reportAsBot: async input => {
      reports.push(input as unknown as Record<string, any>);
      return { issueId: "issue-1", issueNumber: 1 };
    },
  });

  assert.match(
    reports[0]?.idempotencyKey,
    /^bot-report:v1:[a-f0-9]{64}$/
  );
});

test("runs comment edits with the updated content and edit invocation type", async () => {
  const { models, creates } = makeExecModels([
    installedEdge("mybot", ["comment.edited"]),
  ]);
  let receivedEnvelope: unknown;
  const CapturingPlugin: PluginConstructor = class {
    constructor(..._args: unknown[]) {}
    async handleEvent(envelope: unknown) {
      receivedEnvelope = envelope;
      return { success: true };
    }
  };

  await execRun(models, loaderFor(CapturingPlugin), "comment.edited");

  assert.equal(creates.length, 1);
  assert.equal(creates[0].input[0].eventType, "comment.edited");
  assert.partialDeepStrictEqual(receivedEnvelope, {
    type: "comment.edited",
    payload: {
      commentId: "comment-1",
      commentText: "hello bot",
      context: {
        invocationType: "comment-edited",
        comment: { id: "comment-1", text: "hello bot" },
      },
    },
  });
});

test("passes canonical server rules to the plugin invocation context", async () => {
  const { models } = makeExecModels([installedEdge("mybot")]);
  let receivedContext: unknown;
  const CapturingPlugin: PluginConstructor = class {
    constructor(..._args: unknown[]) {}
    async handleEvent(envelope: unknown) {
      const event = envelope as { payload?: { context?: unknown } };
      receivedContext = event.payload?.context;
      return { success: true };
    }
  };

  await execRun(models, loaderFor(CapturingPlugin));

  assert.deepEqual(
    (receivedContext as { server?: { rules?: string[] } })?.server?.rules,
    ["No spam", "No threats"]
  );
});

test("passes version-aware channel enablement and canonical forum rules", async () => {
  const { models, creates } = makeExecModels([installedEdge("mybot")], {
    channelRules: ["Stay on topic", "No spoilers"],
    channelPluginEdges: [
      {
        properties: { enabled: true, settingsJson: null },
        node: { id: "pv-mybot", Plugin: { name: "mybot" } },
      },
    ],
  });
  let receivedContext: unknown;
  const CapturingPlugin: PluginConstructor = class {
    constructor(..._args: unknown[]) {}
    async handleEvent(envelope: unknown) {
      const event = envelope as { payload?: { context?: unknown } };
      receivedContext = event.payload?.context;
      return { success: true };
    }
  };

  await execRun(models, loaderFor(CapturingPlugin));

  assert.deepEqual(
    (receivedContext as {
      channel?: { pluginEnabled?: boolean; rules?: string[] };
    })?.channel,
    {
      uniqueName: "cats",
      displayName: "Cats",
      description: null,
      rules: ["Stay on topic", "No spoilers"],
      pluginEnabled: true,
    }
  );
  assert.equal(creates.length, 1, "channel enablement does not create a second run");
});

test("prefers exact disabled version state and ignores its channel settings", async () => {
  const { models } = makeExecModels([installedEdge("mybot")], {
    channelPluginEdges: [
      {
        properties: {
          enabled: false,
          settingsJson: JSON.stringify({ confidenceThreshold: 0.1 }),
        },
        node: { id: "pv-mybot", Plugin: { name: "mybot" } },
      },
      {
        properties: {
          enabled: true,
          settingsJson: JSON.stringify({ confidenceThreshold: 0.2 }),
        },
        node: { id: "pv-old", Plugin: { name: "mybot" } },
      },
    ],
  });
  let receivedContext: unknown;
  let receivedSettings: unknown;
  const CapturingPlugin: PluginConstructor = class {
    constructor(context: unknown) {
      receivedSettings = (context as { settings?: unknown }).settings;
    }
    async handleEvent(envelope: unknown) {
      receivedContext = (envelope as { payload?: { context?: unknown } }).payload?.context;
      return { success: true };
    }
  };

  await execRun(models, loaderFor(CapturingPlugin));

  assert.equal(
    (receivedContext as { channel?: { pluginEnabled?: boolean } })?.channel?.pluginEnabled,
    false
  );
  assert.deepEqual(receivedSettings, {});
});

test("falls back to plugin-name channel enablement for migrated edges", async () => {
  const { models } = makeExecModels([installedEdge("mybot")], {
    channelPluginEdges: [
      {
        properties: { enabled: true, settingsJson: null },
        node: { Plugin: { name: "mybot" } },
      },
    ],
  });
  let pluginEnabled = false;
  const CapturingPlugin: PluginConstructor = class {
    constructor(..._args: unknown[]) {}
    async handleEvent(envelope: unknown) {
      pluginEnabled = Boolean(
        (envelope as {
          payload?: { context?: { channel?: { pluginEnabled?: boolean } } };
        }).payload?.context?.channel?.pluginEnabled
      );
      return { success: true };
    }
  };

  await execRun(models, loaderFor(CapturingPlugin));

  assert.equal(pluginEnabled, true);
});

test("applies settings from the exact enabled plugin version", async () => {
  const baseEdge = installedEdge("mybot");
  const edge = {
    ...baseEdge,
    node: {
      ...baseEdge.node,
      settingsDefaults: JSON.stringify({
        server: { mode: "default" },
        channel: { confidenceThreshold: 0.9 },
      }),
    },
  };
  const { models } = makeExecModels([edge], {
    channelPluginEdges: [
      {
        properties: {
          enabled: true,
          settingsJson: JSON.stringify({
            confidenceThreshold: 0.2,
            profileId: "strict",
          }),
        },
        node: { id: "pv-mybot", Plugin: { name: "mybot" } },
      },
    ],
  });
  let receivedSettings: unknown;
  const CapturingPlugin: PluginConstructor = class {
    constructor(context: unknown) {
      receivedSettings = (context as { settings?: unknown }).settings;
    }
    async handleEvent() {
      return { success: true };
    }
  };

  await execRun(models, loaderFor(CapturingPlugin));

  assert.deepEqual(receivedSettings, {
    server: { mode: "default" },
    channel: { confidenceThreshold: 0.2, profileId: "strict" },
  });
});

test("prefers an enabled migrated edge when duplicate legacy edges disagree", async () => {
  const { models } = makeExecModels([installedEdge("mybot")], {
    channelPluginEdges: [
      {
        properties: {
          enabled: false,
          settingsJson: JSON.stringify({ profileId: "disabled" }),
        },
        node: { Plugin: { name: "mybot" } },
      },
      {
        properties: {
          enabled: true,
          settingsJson: JSON.stringify({ profileId: "enabled" }),
        },
        node: { Plugin: { name: "mybot" } },
      },
    ],
  });
  let receivedContext: unknown;
  let receivedSettings: unknown;
  const CapturingPlugin: PluginConstructor = class {
    constructor(context: unknown) {
      receivedSettings = (context as { settings?: unknown }).settings;
    }
    async handleEvent(envelope: unknown) {
      receivedContext = (envelope as { payload?: { context?: unknown } }).payload?.context;
      return { success: true };
    }
  };

  await execRun(models, loaderFor(CapturingPlugin));

  assert.equal(
    (receivedContext as { channel?: { pluginEnabled?: boolean } })?.channel?.pluginEnabled,
    true
  );
  assert.deepEqual(receivedSettings, { channel: { profileId: "enabled" } });
});

test("retains an enabled migrated edge when a later duplicate is disabled", async () => {
  const { models } = makeExecModels([installedEdge("mybot")], {
    channelPluginEdges: [
      {
        properties: {
          enabled: true,
          settingsJson: JSON.stringify({ profileId: "enabled" }),
        },
        node: { Plugin: { name: "mybot" } },
      },
      {
        properties: {
          enabled: false,
          settingsJson: JSON.stringify({ profileId: "disabled" }),
        },
        node: { Plugin: { name: "mybot" } },
      },
    ],
  });
  let receivedSettings: unknown;
  const CapturingPlugin: PluginConstructor = class {
    constructor(context: unknown) {
      receivedSettings = (context as { settings?: unknown }).settings;
    }
    async handleEvent() {
      return { success: true };
    }
  };

  await execRun(models, loaderFor(CapturingPlugin));

  assert.deepEqual(receivedSettings, { channel: { profileId: "enabled" } });
});

test("does not apply another plugin version's channel enablement", async () => {
  const { models } = makeExecModels([installedEdge("mybot")], {
    channelPluginEdges: [
      {
        properties: { enabled: true, settingsJson: null },
        node: { id: "pv-old", Plugin: { name: "mybot" } },
      },
    ],
  });
  let pluginEnabled = true;
  const CapturingPlugin: PluginConstructor = class {
    constructor(..._args: unknown[]) {}
    async handleEvent(envelope: unknown) {
      pluginEnabled = Boolean(
        (envelope as {
          payload?: { context?: { channel?: { pluginEnabled?: boolean } } };
        }).payload?.context?.channel?.pluginEnabled
      );
      return { success: true };
    }
  };

  await execRun(models, loaderFor(CapturingPlugin));

  assert.equal(pluginEnabled, false);
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

const triggerPluginRunsForComment = (
  args: Parameters<typeof actualTrigger>[0],
  models: Models,
  options: TriggerOptions = {}
) => actualTrigger(args, {
  ...options,
  commentRepository: commentExecutionRepositoryStub(models),
  leaseRepository: pipelineLeaseRepositoryStub(models),
  attemptRepository: pipelineAttemptRepositoryStub(models.PluginPipelineRun),
});
