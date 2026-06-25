// Unit tests for the comment plugin trigger's decision logic: which comments
// trigger plugin runs, how the channel/server pipelines are selected, and the
// early-return guards. These drive triggerPluginRunsForComment through its
// branching with stubbed OGM models, stopping before the live plugin-execution
// path (network / bot writes), which is left to integration coverage.
import assert from "node:assert/strict";
import test from "node:test";
import { isCommentEvent, triggerPluginRunsForComment } from "./commentTrigger.js";

const EVENT = "comment.created";

// A minimal OGM model stub whose find() returns the supplied rows.
const model = (rows: unknown[]) => ({ find: async () => rows });
const empty = () => model([]);

// Build the `models` bag triggerPluginRunsForComment destructures. Only
// Comment/Channel/ServerConfig are read on the decision path; the rest are
// no-op stubs so unrelated lookups never crash.
function makeModels(opts: {
  comment?: unknown | null;
  channel?: unknown | null;
  serverConfig?: unknown | null;
} = {}): any {
  return {
    Comment: model(opts.comment ? [opts.comment] : []),
    Channel: model(opts.channel ? [opts.channel] : []),
    ServerConfig: model(opts.serverConfig ? [opts.serverConfig] : []),
    Discussion: empty(),
    Event: empty(),
    Issue: empty(),
    PluginRun: empty(),
    ServerSecret: empty(),
    User: empty(),
  };
}

// A valid discussion comment that *would* trigger plugins (overridden per test).
const discussionComment = () => ({
  id: "comment-1",
  text: "hello bot",
  botMentions: [],
  isFeedbackComment: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  CommentAuthor: { username: "alice", isBot: false },
  DiscussionChannel: {
    id: "dc-1",
    discussionId: "d-1",
    channelUniqueName: "cats",
    Discussion: { id: "d-1", title: "T", body: "B" },
  },
  Channel: { uniqueName: "cats" },
  Event: null,
  Issue: null,
  ParentComment: null,
});

const run = (models: any, event = EVENT, commentId = "comment-1") =>
  triggerPluginRunsForComment({ commentId, event, models, driver: {} as any });

test("isCommentEvent recognizes only comment.created", () => {
  assert.equal(isCommentEvent("comment.created"), true);
  assert.equal(isCommentEvent("discussion.created"), false);
  assert.equal(isCommentEvent(""), false);
});

test("throws on an unsupported event", async () => {
  await assert.rejects(
    run(makeModels(), "comment.deleted"),
    /Unsupported comment plugin event: comment\.deleted/
  );
});

test("throws when the comment does not exist", async () => {
  await assert.rejects(
    run(makeModels({ comment: null })),
    /Comment "comment-1" not found/
  );
});

test("ignores feedback comments", async () => {
  const comment = { ...discussionComment(), isFeedbackComment: true };
  assert.deepEqual(await run(makeModels({ comment })), []);
});

test("ignores comments scoped to an event", async () => {
  const comment = {
    ...discussionComment(),
    Event: { id: "e-1", EventChannels: [{ channelUniqueName: "cats" }] },
  };
  assert.deepEqual(await run(makeModels({ comment })), []);
});

test("ignores comments scoped to an issue", async () => {
  const comment = { ...discussionComment(), Issue: { id: "i-1" } };
  assert.deepEqual(await run(makeModels({ comment })), []);
});

test("returns [] when no channel can be resolved", async () => {
  const comment = {
    ...discussionComment(),
    DiscussionChannel: { id: "dc-1", discussionId: "d-1", channelUniqueName: null, Discussion: null },
    Channel: null,
    Event: null,
  };
  assert.deepEqual(await run(makeModels({ comment })), []);
});

test("returns [] when there is no server config", async () => {
  const channel = { uniqueName: "cats", pluginPipelines: null, EnabledPluginsConnection: { edges: [] } };
  assert.deepEqual(
    await run(makeModels({ comment: discussionComment(), channel, serverConfig: null })),
    []
  );
});

test("returns [] when no plugins are installed (fallback path)", async () => {
  const channel = { uniqueName: "cats", pluginPipelines: null, EnabledPluginsConnection: { edges: [] } };
  const serverConfig = {
    serverName: "s",
    pluginPipelines: null,
    InstalledVersionsConnection: { edges: [] },
  };
  assert.deepEqual(
    await run(makeModels({ comment: discussionComment(), channel, serverConfig })),
    []
  );
});

test("returns [] when an installed plugin does not handle comment.created", async () => {
  const channel = { uniqueName: "cats", pluginPipelines: null, EnabledPluginsConnection: { edges: [] } };
  const serverConfig = {
    serverName: "s",
    pluginPipelines: null,
    InstalledVersionsConnection: {
      edges: [
        {
          properties: { enabled: true, settingsJson: null },
          node: {
            id: "pv-1",
            version: "1.0.0",
            manifest: JSON.stringify({ events: ["discussion.created"] }),
            Plugin: { id: "p-1", name: "summarizer" },
          },
        },
      ],
    },
  };
  assert.deepEqual(
    await run(makeModels({ comment: discussionComment(), channel, serverConfig })),
    []
  );
});

test("returns [] when a channel pipeline references an uninstalled plugin", async () => {
  const channel = {
    uniqueName: "cats",
    pluginPipelines: [
      { event: "comment.created", steps: [{ pluginId: "ghost", condition: "ALWAYS" }] },
    ],
    EnabledPluginsConnection: { edges: [] },
  };
  const serverConfig = {
    serverName: "s",
    pluginPipelines: null,
    InstalledVersionsConnection: { edges: [] },
  };
  assert.deepEqual(
    await run(makeModels({ comment: discussionComment(), channel, serverConfig })),
    []
  );
});
