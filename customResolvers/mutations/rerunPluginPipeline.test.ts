import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { createRerunPluginPipelineResolver } from "./rerunPluginPipeline.js";

const EVENT = "downloadableFile.created";
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

const sourceAttempt = {
  pipelineId: "source-pipeline",
  targetId: "file-1",
  targetType: "DownloadableFile",
  eventType: EVENT,
  scope: "SERVER",
  channelId: null,
  status: "FAILED",
  trigger: "EVENT",
  createdAt: "2026-07-30T11:50:00.000Z",
};

const contextFor = (username: string) =>
  ({ user: { username } }) as GraphQLContext;

const makeInput = ({
  source = sourceAttempt,
  related = [sourceAttempt],
} = {}) => ({
  Channel: { find: async () => [] },
  Discussion: { find: async () => [] },
  DownloadableFile: {
    find: async () => [
      {
        id: "file-1",
        uploadedByUsername: "alice",
        uploadedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
  },
  Plugin: {},
  PluginVersion: {},
  PluginPipelineRun: {
    find: async ({ where }: any) => {
      if (where.pipelineId === "source-pipeline") {
        return source ? [source] : [];
      }
      if (where.pipelineId) {
        return [{ pipelineId: where.pipelineId, status: "SUCCEEDED" }];
      }
      if (where.status_IN) return [];
      return related;
    },
  },
  PluginRun: {},
  ServerConfig: { find: async () => [config] },
  ServerSecret: {},
}) as any;

test("reruns a failed pipeline for its owner with retry lineage", async () => {
  let execution: any;
  const resolver = createRerunPluginPipelineResolver(
    makeInput(),
    async () => false,
    (async (_args: unknown, options: any) => {
      execution = options.execution;
      return [];
    }) as any,
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
  const resolver = createRerunPluginPipelineResolver(
    makeInput(),
    async () => true,
    (async (_args: unknown, options: any) => {
      trigger = options.execution.trigger;
      return [];
    }) as any,
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
      source: { ...sourceAttempt, status: "RUNNING" },
      related: [{ ...sourceAttempt, status: "RUNNING" }],
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
    trigger: "OWNER_RETRY",
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
          status: "SUCCEEDED",
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
      trigger: "OWNER_RETRY",
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
    makeInput({ source: null as any, related: [] }),
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
      } as any,
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
  const channelEvent = "discussionChannel.created";
  const channelSource = {
    ...sourceAttempt,
    targetId: "discussion-1",
    targetType: "Discussion",
    eventType: channelEvent,
    scope: "CHANNEL",
    channelId: "cats",
  };
  const input = makeInput({
    source: channelSource as any,
    related: [channelSource] as any,
  });
  input.Discussion.find = async () => [
    {
      id: "discussion-1",
      Author: { username: "alice" },
      DownloadableFile: {
        uploadedAt: "2025-01-01T00:00:00.000Z",
        uploadedByUsername: "alice",
      },
      DiscussionChannels: [
        { channelUniqueName: "cats", archived: false },
      ],
    },
  ];
  input.Channel.find = async () => [
    {
      uniqueName: "cats",
      pluginPipelines: [
        { event: channelEvent, steps: [{ pluginId: "scanner" }] },
      ],
    },
  ];
  input.ServerConfig.find = async () => [
    {
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
    },
  ];
  let invocation: any;
  const resolver = createRerunPluginPipelineResolver(
    input,
    async () => false,
    (async () => []) as any,
    (async (args: unknown, options: unknown) => {
      invocation = { args, options };
      return [];
    }) as any,
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
      trigger: invocation.options.execution.trigger,
      retryOf: invocation.options.execution.retryOfPipelineRunId,
    },
    {
      channel: "cats",
      trigger: "OWNER_RETRY",
      retryOf: "source-pipeline",
    }
  );
});
