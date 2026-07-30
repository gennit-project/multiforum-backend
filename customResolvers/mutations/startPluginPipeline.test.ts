import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { createStartPluginPipelineResolver } from "./startPluginPipeline.js";

const EVENT = "downloadableFile.created";

const installedEdge = {
  properties: { enabled: true, settingsJson: null },
  node: {
    id: "version-1",
    version: "1.0.0",
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

const requiredConfig = {
  pluginPipelines: [
    {
      event: EVENT,
      applicability: "ALL_FILES_IMMEDIATE",
      steps: [{ pluginId: "scanner" }],
    },
  ],
  InstalledVersionsConnection: { edges: [installedEdge] },
};

const contextFor = (username?: string) =>
  ({ user: username ? { username } : undefined }) as GraphQLContext;

const makeInput = ({
  file = {
    id: "file-1",
    uploadedByUsername: "alice",
    uploadedAt: "2025-01-01T00:00:00.000Z",
  },
  config = requiredConfig,
  activeAttempts = [] as unknown[],
  discussion = null as unknown,
  channel = null as unknown,
} = {}) => {
  const createdAttempt = {
    id: "attempt-1",
    pipelineId: "captured-by-trigger",
    status: "SUCCEEDED",
  };
  const PluginPipelineRun = {
    find: async ({ where }: any) =>
      where.pipelineId
        ? [{ ...createdAttempt, pipelineId: where.pipelineId }]
        : activeAttempts,
  };
  return {
    input: {
      Channel: { find: async () => (channel ? [channel] : []) },
      Discussion: { find: async () => (discussion ? [discussion] : []) },
      DownloadableFile: { find: async () => (file ? [file] : []) },
      Plugin: {},
      PluginVersion: {},
      PluginPipelineRun,
      PluginRun: {},
      ServerConfig: { find: async () => (config ? [config] : []) },
      ServerSecret: {},
    } as any,
    createdAttempt,
  };
};

test("lets the uploader start a required missing pipeline", async () => {
  const { input } = makeInput();
  let execution: any;
  const resolver = createStartPluginPipelineResolver(
    input,
    async () => false,
    (async (_args: unknown, options: any) => {
      execution = options.execution;
      return [];
    }) as any
  );

  const result = await resolver(
    null,
    {
      targetId: "file-1",
      targetType: "DownloadableFile",
      eventType: EVENT,
    },
    contextFor("alice")
  );

  assert.deepEqual(
    {
      resultPipelineId: result.pipelineId,
      trigger: execution.trigger,
      actor: execution.initiatedByUsername,
      fixedPipelineId:
        typeof execution.pipelineId === "string" &&
        execution.pipelineId.length > 0,
    },
    {
      resultPipelineId: execution.pipelineId,
      trigger: "OWNER_START",
      actor: "alice",
      fixedPipelineId: true,
    }
  );
});

test("records a moderator start for someone else's download", async () => {
  const { input } = makeInput();
  let trigger: string | undefined;
  const resolver = createStartPluginPipelineResolver(
    input,
    async () => true,
    (async (_args: unknown, options: any) => {
      trigger = options.execution.trigger;
      return [];
    }) as any
  );

  await resolver(
    null,
    {
      targetId: "file-1",
      targetType: "DownloadableFile",
      eventType: EVENT,
    },
    contextFor("moderator")
  );

  assert.equal(trigger, "MODERATOR_START");
});

test("rejects a non-owner without moderation authority", async () => {
  const { input } = makeInput();
  const resolver = createStartPluginPipelineResolver(
    input,
    async () => false
  );

  await assert.rejects(
    resolver(
      null,
      {
        targetId: "file-1",
        targetType: "DownloadableFile",
        eventType: EVENT,
      },
      contextFor("bob")
    ),
    /Not authorized/
  );
});

test("rejects a pipeline that is not required by rollout policy", async () => {
  const config = {
    ...requiredConfig,
    pluginPipelines: [
      {
        ...requiredConfig.pluginPipelines[0],
        applicability: "NEW_FILES_ONLY",
        effectiveAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  const { input } = makeInput({ config });
  const resolver = createStartPluginPipelineResolver(input);

  await assert.rejects(
    resolver(
      null,
      {
        targetId: "file-1",
        targetType: "DownloadableFile",
        eventType: EVENT,
      },
      contextFor("alice")
    ),
    /not required for files uploaded before/
  );
});

test("rejects a duplicate active attempt", async () => {
  const { input } = makeInput({
    activeAttempts: [{ pipelineId: "already-running" }],
  });
  const resolver = createStartPluginPipelineResolver(input);

  await assert.rejects(
    resolver(
      null,
      {
        targetId: "file-1",
        targetType: "DownloadableFile",
        eventType: EVENT,
      },
      contextFor("alice")
    ),
    /already has an active attempt/
  );
});

test("rejects unsupported target types", async () => {
  const { input } = makeInput();
  const resolver = createStartPluginPipelineResolver(input);

  await assert.rejects(
    resolver(
      null,
      {
        targetId: "discussion-1",
        targetType: "Event",
        eventType: "event.created",
      },
      contextFor("alice")
    ),
    /require a DownloadableFile or Discussion target/
  );
});

test("starts the explicitly selected channel pipeline", async () => {
  const channelEvent = "discussionChannel.created";
  const channelEdge = {
    ...installedEdge,
    node: {
      ...installedEdge.node,
      manifest: JSON.stringify({ events: [channelEvent] }),
    },
  };
  const { input } = makeInput({
    discussion: {
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
    channel: {
      uniqueName: "cats",
      pluginPipelines: [
        { event: channelEvent, steps: [{ pluginId: "scanner" }] },
      ],
    },
    config: {
      pluginPipelines: [],
      InstalledVersionsConnection: { edges: [channelEdge] },
    },
  });
  let invocation: any;
  const resolver = createStartPluginPipelineResolver(
    input,
    async () => false,
    (async () => []) as any,
    (async (args: unknown, options: unknown) => {
      invocation = { args, options };
      return [];
    }) as any
  );

  await resolver(
    null,
    {
      targetId: "discussion-1",
      targetType: "Discussion",
      eventType: channelEvent,
      channelId: "cats",
    },
    contextFor("alice")
  );

  assert.deepEqual(
    {
      discussionId: invocation.args.discussionId,
      channelUniqueName: invocation.args.channelUniqueName,
      trigger: invocation.options.execution.trigger,
    },
    {
      discussionId: "discussion-1",
      channelUniqueName: "cats",
      trigger: "OWNER_START",
    }
  );
});
