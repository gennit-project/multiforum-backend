import assert from "node:assert/strict";
import test from "node:test";
import type { PluginPipelineRun } from "../../ogm_types.js";
import {
  PluginPipelineRunStatus,
  PluginPipelineRunTrigger,
} from "../../ogm_types.js";
import { PLUGIN_EVENTS } from "../../services/plugin/constants.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  createRerunPluginPipelineResolver,
  type RerunPluginPipelineInput,
} from "./rerunPluginPipeline.js";

type DownloadTrigger = NonNullable<
  Parameters<typeof createRerunPluginPipelineResolver>[2]
>;
type ChannelTrigger = NonNullable<
  Parameters<typeof createRerunPluginPipelineResolver>[3]
>;
type DownloadTriggerOptions = NonNullable<Parameters<DownloadTrigger>[1]>;
type ChannelTriggerOptions = NonNullable<Parameters<ChannelTrigger>[1]>;

const EVENT = PLUGIN_EVENTS.DOWNLOADABLE_FILE_CREATED;
const NOW = Date.parse("2026-07-30T12:00:00.000Z");

const installedEdge = {
  properties: { enabled: true, settingsJson: null },
  node: {
    id: "version-1",
    version: "2.0.0",
    repoUrl: "https://example.test/plugin",
    tarballGsUri: "gs://plugins/scanner.tgz",
    entryPath: "dist/index.js",
    manifest: JSON.stringify({ events: [EVENT] }),
    settingsDefaults: null,
    uiSchema: null,
    Plugin: {
      id: "scanner",
      name: "scanner",
      displayName: "Scanner",
      description: "",
      metadata: null,
    },
  },
};

const config = {
  pluginPipelines: [
    {
      event: EVENT,
      applicability: "ALL_FILES_IMMEDIATE",
      steps: [{ pluginId: "scanner" }],
    },
  ],
  InstalledVersionsConnection: { edges: [installedEdge] },
};

type AttemptRecord = Pick<
  PluginPipelineRun,
  | "pipelineId"
  | "targetId"
  | "targetType"
  | "targetVersion"
  | "eventType"
  | "scope"
  | "channelId"
  | "status"
  | "trigger"
  | "createdAt"
>;

const sourceAttempt: AttemptRecord = {
  pipelineId: "source-pipeline",
  targetId: "file-1",
  targetType: "DownloadableFile",
  eventType: EVENT,
  scope: "SERVER",
  channelId: null,
  status: PluginPipelineRunStatus.Failed,
  trigger: PluginPipelineRunTrigger.Event,
  createdAt: "2026-07-30T11:50:00.000Z",
};

const contextFor = (username: string) =>
  ({ user: { username } }) as GraphQLContext;

type DiscussionFixture = {
  id: string;
  Author: { username: string };
  DownloadableFile: {
    uploadedAt: string;
    uploadedByUsername: string;
  };
  DiscussionChannels: Array<{
    channelUniqueName: string;
    archived: boolean;
  }>;
};

type ChannelFixture = {
  uniqueName: string;
  pluginPipelines: Array<{
    event: string;
    steps: Array<{ pluginId: string }>;
  }>;
};

const makeInput = ({
  source = sourceAttempt,
  related = [sourceAttempt],
  discussion = null,
  channel = null,
  serverConfig = config,
}: {
  source?: AttemptRecord | null;
  related?: AttemptRecord[];
  discussion?: DiscussionFixture | null;
  channel?: ChannelFixture | null;
  serverConfig?: unknown;
} = {}): RerunPluginPipelineInput => ({
  Channel: modelStub<"Channel">({
    find: async () => (channel ? [channel] : []),
  }),
  Discussion: modelStub<"Discussion">({
    find: async () => (discussion ? [discussion] : []),
  }),
  DownloadableFile: modelStub<"DownloadableFile">({
    find: async () => [
      {
        id: "file-1",
        uploadedByUsername: "alice",
        uploadedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
  }),
  Plugin: modelStub<"Plugin">(),
  PluginVersion: modelStub<"PluginVersion">(),
  PluginPipelineRun: modelStub<"PluginPipelineRun">({
    find: async ({ where } = {}) => {
      if (where?.pipelineId === "source-pipeline") {
        return source ? [source] : [];
      }
      if (where?.pipelineId) {
        return [{ pipelineId: where.pipelineId, status: "SUCCEEDED" }];
      }
      if (where?.status_IN) return [];
      return related;
    },
  }),
  PluginRun: modelStub<"PluginRun">(),
  ServerConfig: modelStub<"ServerConfig">({
    find: async () => [serverConfig],
  }),
  ServerSecret: modelStub<"ServerSecret">(),
});

test("reruns a failed pipeline for its owner with retry lineage", async () => {
  let execution!: NonNullable<DownloadTriggerOptions["execution"]>;
  const triggerDownloadRuns: DownloadTrigger = async (_args, options = {}) => {
    execution = options.execution!;
    return [];
  };
  const resolver = createRerunPluginPipelineResolver(
    makeInput(),
    async () => false,
    triggerDownloadRuns,
    undefined,
    () => NOW
  );

  const result = await resolver(
    null,
    { pipelineRunId: "source-pipeline" },
    contextFor("alice")
  );

  assert.deepEqual(
    {
      resultPipelineId: result.pipelineId,
      trigger: execution.trigger,
      actor: execution.initiatedByUsername,
      retryOf: execution.retryOfPipelineRunId,
    },
    {
      resultPipelineId: execution.pipelineId,
      trigger: "OWNER_RETRY",
      actor: "alice",
      retryOf: "source-pipeline",
    }
  );
});

test("records moderator retry metadata", async () => {
  let trigger: string | undefined;
  const triggerDownloadRuns: DownloadTrigger = async (_args, options = {}) => {
    trigger = options.execution?.trigger;
    return [];
  };
  const resolver = createRerunPluginPipelineResolver(
    makeInput(),
    async () => true,
    triggerDownloadRuns,
    undefined,
    () => NOW
  );

  await resolver(
    null,
    { pipelineRunId: "source-pipeline" },
    contextFor("moderator")
  );

  assert.equal(trigger, "MODERATOR_RETRY");
});

test("rejects a non-terminal source attempt", async () => {
  const resolver = createRerunPluginPipelineResolver(
    makeInput({
      source: {
        ...sourceAttempt,
        status: PluginPipelineRunStatus.Running,
      },
      related: [
        {
          ...sourceAttempt,
          status: PluginPipelineRunStatus.Running,
        },
      ],
    }),
    undefined,
    undefined,
    undefined,
    () => NOW
  );

  await assert.rejects(
    resolver(
      null,
      { pipelineRunId: "source-pipeline" },
      contextFor("alice")
    ),
    /Only failed, timed out, or cancelled/
  );
});

test("enforces a one-minute retry cooldown", async () => {
  const recentAttempt = {
    ...sourceAttempt,
    trigger: PluginPipelineRunTrigger.OwnerRetry,
    createdAt: "2026-07-30T11:59:30.000Z",
  };
  const resolver = createRerunPluginPipelineResolver(
    makeInput({ source: recentAttempt, related: [recentAttempt] }),
    undefined,
    undefined,
    undefined,
    () => NOW
  );

  await assert.rejects(
    resolver(
      null,
      { pipelineRunId: "source-pipeline" },
      contextFor("alice")
    ),
    /wait at least one minute/
  );
});

test("rejects retries of an older superseded attempt", async () => {
  const resolver = createRerunPluginPipelineResolver(
    makeInput({
      related: [
        sourceAttempt,
        {
          ...sourceAttempt,
          pipelineId: "newer-pipeline",
          status: PluginPipelineRunStatus.Succeeded,
          createdAt: "2026-07-30T11:55:00.000Z",
        },
      ],
    }),
    undefined,
    undefined,
    undefined,
    () => NOW
  );

  await assert.rejects(
    resolver(
      null,
      { pipelineRunId: "source-pipeline" },
      contextFor("alice")
    ),
    /Only the latest pipeline attempt/
  );
});

test("limits a pipeline to three retries per hour", async () => {
  const related = [
    sourceAttempt,
    ...["11:10", "11:20", "11:30"].map((time, index) => ({
      ...sourceAttempt,
      pipelineId: `retry-${index}`,
      trigger: PluginPipelineRunTrigger.OwnerRetry,
      createdAt: `2026-07-30T${time}:00.000Z`,
    })),
  ];
  const resolver = createRerunPluginPipelineResolver(
    makeInput({ related }),
    undefined,
    undefined,
    undefined,
    () => NOW
  );

  await assert.rejects(
    resolver(
      null,
      { pipelineRunId: "source-pipeline" },
      contextFor("alice")
    ),
    /reached the retry limit/
  );
});

test("returns not found for an unknown source attempt", async () => {
  const resolver = createRerunPluginPipelineResolver(
    makeInput({ source: null, related: [] }),
    undefined,
    undefined,
    undefined,
    () => NOW
  );

  await assert.rejects(
    resolver(
      null,
      { pipelineRunId: "source-pipeline" },
      contextFor("alice")
    ),
    /Pipeline attempt not found/
  );
});

test("does not rerun an attempt against replacement file bytes", async () => {
  const resolver = createRerunPluginPipelineResolver(
    makeInput({
      source: {
        ...sourceAttempt,
        targetVersion: "2024-01-01T00:00:00.000Z",
      },
      related: [sourceAttempt],
    }),
    undefined,
    undefined,
    undefined,
    () => NOW
  );

  await assert.rejects(
    resolver(
      null,
      { pipelineRunId: "source-pipeline" },
      contextFor("alice")
    ),
    /file has changed/
  );
});

test("reruns a channel pipeline with channel retry lineage", async () => {
  const channelEvent = PLUGIN_EVENTS.DISCUSSION_CHANNEL_CREATED;
  const channelSource: AttemptRecord = {
    ...sourceAttempt,
    targetId: "discussion-1",
    targetType: "Discussion",
    eventType: channelEvent,
    scope: "CHANNEL",
    channelId: "cats",
  };
  const discussion = {
    id: "discussion-1",
    Author: { username: "alice" },
    DownloadableFile: {
      uploadedAt: "2025-01-01T00:00:00.000Z",
      uploadedByUsername: "alice",
    },
    DiscussionChannels: [{ channelUniqueName: "cats", archived: false }],
  };
  const channel = {
    uniqueName: "cats",
    pluginPipelines: [
      { event: channelEvent, steps: [{ pluginId: "scanner" }] },
    ],
  };
  const channelServerConfig = {
    pluginPipelines: [],
    InstalledVersionsConnection: {
      edges: [
        {
          ...installedEdge,
          node: {
            ...installedEdge.node,
            manifest: JSON.stringify({ events: [channelEvent] }),
          },
        },
      ],
    },
  };
  const input = makeInput({
    source: channelSource,
    related: [channelSource],
    discussion,
    channel,
    serverConfig: channelServerConfig,
  });
  let invocation!: {
    args: Parameters<ChannelTrigger>[0];
    options: ChannelTriggerOptions;
  };
  const triggerDownloadRuns: DownloadTrigger = async () => [];
  const triggerChannelRuns: ChannelTrigger = async (args, options = {}) => {
    invocation = { args, options };
    return [];
  };
  const resolver = createRerunPluginPipelineResolver(
    input,
    async () => false,
    triggerDownloadRuns,
    triggerChannelRuns,
    () => NOW
  );

  await resolver(
    null,
    { pipelineRunId: "source-pipeline" },
    contextFor("alice")
  );

  assert.deepEqual(
    {
      channel: invocation.args.channelUniqueName,
      trigger: invocation.options.execution!.trigger,
      retryOf: invocation.options.execution!.retryOfPipelineRunId,
    },
    {
      channel: "cats",
      trigger: "OWNER_RETRY",
      retryOf: "source-pipeline",
    }
  );
});
