// Unit tests for the channel (discussion-with-download) plugin trigger's
// decision logic: it fires a configured channel pipeline when a discussion that
// has a downloadable file is posted. These drive triggerChannelPluginPipeline
// through every guard and the step-filtering with stubbed OGM models (no DB),
// stopping before the live plugin-execution path.
import assert from "node:assert/strict";
import test from "node:test";
import { isChannelEvent, triggerChannelPluginPipeline } from "./channelTrigger.js";

const EVENT = "discussionChannel.created";

const model = (rows: unknown[]) => ({ find: async () => rows });
const empty = () => model([]);

function makeModels(opts: {
  channel?: unknown | null;
  discussion?: unknown | null;
  serverConfig?: unknown | null;
} = {}): any {
  return {
    Channel: model(opts.channel ? [opts.channel] : []),
    Discussion: model(opts.discussion ? [opts.discussion] : []),
    ServerConfig: model(opts.serverConfig ? [opts.serverConfig] : []),
    DownloadableFile: empty(),
    PluginRun: empty(),
    ServerSecret: empty(),
    Plugin: empty(),
    PluginVersion: empty(),
  };
}

const channelWith = (pluginPipelines: unknown[]) => ({
  uniqueName: "cats",
  displayName: "Cats",
  description: "",
  rules: [],
  pluginPipelines,
  Tags: [],
  FilterGroups: [],
  EnabledPluginsConnection: { edges: [] },
});

const pipelineForEvent = {
  event: EVENT,
  steps: [{ pluginId: "p1", condition: "ALWAYS" }],
};

const discussionWithFile = {
  id: "d-1",
  title: "T",
  body: "B",
  DownloadableFile: { id: "f-1", fileName: "a.zip", url: "http://x/a.zip", kind: "zip", size: 10 },
};

const serverConfigNoPlugins = {
  serverName: "s",
  InstalledVersionsConnection: { edges: [] },
};

const run = (models: any, event = EVENT) =>
  triggerChannelPluginPipeline({ discussionId: "d-1", channelUniqueName: "cats", event, models });

test("isChannelEvent recognizes only discussionChannel.created", () => {
  assert.equal(isChannelEvent("discussionChannel.created"), true);
  assert.equal(isChannelEvent("comment.created"), false);
  assert.equal(isChannelEvent(""), false);
});

test("throws on an unsupported event", async () => {
  await assert.rejects(
    run(makeModels(), "discussionChannel.deleted"),
    /Unsupported channel plugin event: discussionChannel\.deleted/
  );
});

test("throws when the channel does not exist", async () => {
  await assert.rejects(run(makeModels({ channel: null })), /Channel "cats" not found/);
});

test("returns [] when no pipeline is configured for the event", async () => {
  const channel = channelWith([{ event: "some.other.event", steps: [{ pluginId: "p1" }] }]);
  assert.deepEqual(await run(makeModels({ channel })), []);
});

test("returns [] when the matching pipeline has no steps", async () => {
  const channel = channelWith([{ event: EVENT, steps: [] }]);
  assert.deepEqual(await run(makeModels({ channel })), []);
});

test("throws when the discussion does not exist", async () => {
  const channel = channelWith([pipelineForEvent]);
  await assert.rejects(
    run(makeModels({ channel, discussion: null })),
    /Discussion "d-1" not found/
  );
});

test("returns [] when the discussion has no downloadable file", async () => {
  const channel = channelWith([pipelineForEvent]);
  const discussion = { id: "d-1", title: "T", body: "B", DownloadableFile: null };
  assert.deepEqual(await run(makeModels({ channel, discussion })), []);
});

test("returns [] when there is no server config", async () => {
  const channel = channelWith([pipelineForEvent]);
  assert.deepEqual(
    await run(makeModels({ channel, discussion: discussionWithFile, serverConfig: null })),
    []
  );
});

test("returns [] when the pipeline's plugin is not server-installed", async () => {
  const channel = channelWith([pipelineForEvent]);
  assert.deepEqual(
    await run(
      makeModels({ channel, discussion: discussionWithFile, serverConfig: serverConfigNoPlugins })
    ),
    []
  );
});
