import assert from "node:assert/strict";
import test from "node:test";
import { PLUGIN_EVENTS } from "../../services/plugin/constants.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  createStartPluginPipelineResolver,
  type StartPluginPipelineInput,
} from "./startPluginPipeline.js";

type DownloadTrigger = NonNullable<
  Parameters<typeof createStartPluginPipelineResolver>[2]
>;
type ChannelTrigger = NonNullable<
  Parameters<typeof createStartPluginPipelineResolver>[3]
>;
type DownloadTriggerOptions = NonNullable<Parameters<DownloadTrigger>[1]>;
type ChannelTriggerOptions = NonNullable<Parameters<ChannelTrigger>[1]>;
type CheckChannelModPermission = NonNullable<
  Parameters<typeof createStartPluginPipelineResolver>[1]
>;

const EVENT = PLUGIN_EVENTS.DOWNLOADABLE_FILE_CREATED;

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
    Discussion: {
      Author: { username: "alice" },
      DiscussionChannels: [
        { channelUniqueName: "cats", archived: false },
      ],
    },
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
  const PluginPipelineRun = modelStub<"PluginPipelineRun">({
    find: async ({ where } = {}) =>
      where?.pipelineId
        ? [{ ...createdAttempt, pipelineId: where.pipelineId }]
        : activeAttempts,
  });
  return {
    input: {
      Channel: modelStub<"Channel">({
        find: async () => (channel ? [channel] : []),
      }),
      Discussion: modelStub<"Discussion">({
        find: async () => (discussion ? [discussion] : []),
      }),
      DownloadableFile: modelStub<"DownloadableFile">({
        find: async () => (file ? [file] : []),
      }),
      Plugin: modelStub<"Plugin">(),
      PluginVersion: modelStub<"PluginVersion">(),
      PluginPipelineRun,
      PluginRun: modelStub<"PluginRun">(),
      ServerConfig: modelStub<"ServerConfig">({
        find: async () => (config ? [config] : []),
      }),
      ServerSecret: modelStub<"ServerSecret">(),
    } satisfies StartPluginPipelineInput,
    createdAttempt,
  };
};

test("lets the uploader start a required missing pipeline", async () => {
  const { input } = makeInput();
  let execution!: NonNullable<DownloadTriggerOptions["execution"]>;
  const triggerDownloadRuns: DownloadTrigger = async (_args, options = {}) => {
    execution = options.execution!;
    return [];
  };
  const resolver = createStartPluginPipelineResolver(
    input,
    async () => false,
    triggerDownloadRuns
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
  let permissionInput: Parameters<CheckChannelModPermission>[0] | undefined;
  const triggerDownloadRuns: DownloadTrigger = async (_args, options = {}) => {
    trigger = options.execution?.trigger;
    return [];
  };
  const checkChannelModPermission: CheckChannelModPermission = async args => {
    permissionInput = args;
    return true;
  };
  const resolver = createStartPluginPipelineResolver(
    input,
    checkChannelModPermission,
    triggerDownloadRuns
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

  assert.deepEqual(
    {
      trigger,
      permission: permissionInput?.permission,
      channelName: permissionInput?.channelName,
    },
    {
      trigger: "MODERATOR_START",
      permission: "canEditDiscussions",
      channelName: "cats",
    }
  );
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

test("does not use moderation authority from an unrelated channel", async () => {
  const { input } = makeInput({
    file: {
      id: "file-1",
      uploadedByUsername: "alice",
      uploadedAt: "2025-01-01T00:00:00.000Z",
      Discussion: {
        Author: { username: "alice" },
        DiscussionChannels: [
          { channelUniqueName: "dogs", archived: false },
        ],
      },
    },
  });
  const resolver = createStartPluginPipelineResolver(
    input,
    async ({ channelName }) => channelName === "cats"
  );

  await assert.rejects(
    resolver(
      null,
      {
        targetId: "file-1",
        targetType: "DownloadableFile",
        eventType: EVENT,
      },
      contextFor("cats-moderator")
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
  const channelEvent = PLUGIN_EVENTS.DISCUSSION_CHANNEL_CREATED;
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
  let invocation!: {
    args: Parameters<ChannelTrigger>[0];
    options: ChannelTriggerOptions;
  };
  const triggerDownloadRuns: DownloadTrigger = async () => [];
  const triggerChannelRuns: ChannelTrigger = async (args, options = {}) => {
    invocation = { args, options };
    return [];
  };
  const resolver = createStartPluginPipelineResolver(
    input,
    async () => false,
    triggerDownloadRuns,
    triggerChannelRuns
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
      trigger: invocation.options.execution!.trigger,
    },
    {
      discussionId: "discussion-1",
      channelUniqueName: "cats",
      trigger: "OWNER_START",
    }
  );
});
