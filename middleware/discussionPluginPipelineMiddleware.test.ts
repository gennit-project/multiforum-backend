import assert from "node:assert/strict";
import test from "node:test";

import { createDiscussionPluginPipelineMiddleware } from "./discussionPluginPipelineMiddleware.js";

const RESULT = { discussions: [{ id: "discussion" }] };
const OLD = {
  id: "discussion",
  title: "Old title",
  body: "Old body",
  DiscussionChannels: [{ channelUniqueName: "old-forum" }],
};

const setup = ({
  snapshots = [OLD, OLD],
  trigger,
}: {
  snapshots?: Array<typeof OLD>;
  trigger?: (args: {
    discussionId: string;
    channelUniqueName: string;
    event: string;
    driver?: unknown;
  }, options?: { execution?: { deferExecution?: boolean } }) => Promise<unknown>;
} = {}) => {
  let reads = 0;
  const calls: Array<{
    discussionId: string;
    channelUniqueName: string;
    event: string;
    driver?: unknown;
  }> = [];
  const driver = {};
  const repository = {
    findMentionSnapshot: async () => [snapshots[Math.min(reads++, snapshots.length - 1)]],
  };
  const triggerChannel = trigger ?? (async args => {
    calls.push(args);
    return [];
  });
  const middleware = createDiscussionPluginPipelineMiddleware(
    triggerChannel as never
  ).Mutation;
  const context = { driver, discussionRevisionRepository: repository } as never;
  return { calls, context, driver, middleware, reads: () => reads };
};

test("fans an edited generated discussion out to each final forum once", async () => {
  const after = {
    ...OLD,
    title: "New title",
    DiscussionChannels: [
      { channelUniqueName: "cats" },
      { channelUniqueName: "dogs" },
      { channelUniqueName: "cats" },
      { channelUniqueName: " " },
    ],
  };
  const { calls, context, driver, middleware } = setup({ snapshots: [OLD, after] });

  const result = await middleware.updateDiscussions(
    async () => RESULT,
    null,
    { where: { id: "discussion" }, update: { title: "New title" } },
    context,
    {} as never
  );

  assert.equal(result, RESULT);
  assert.deepEqual(calls, [
    {
      driver,
      discussionId: "discussion",
      channelUniqueName: "cats",
      event: "discussionChannel.edited",
    },
    {
      driver,
      discussionId: "discussion",
      channelUniqueName: "dogs",
      event: "discussionChannel.edited",
    },
  ]);
});

test("uses the custom mutation input and its final forum membership", async () => {
  const after = {
    ...OLD,
    body: "New body",
    DiscussionChannels: [{ channelUniqueName: "new-forum" }],
  };
  const { calls, context, middleware } = setup({ snapshots: [OLD, after] });

  await middleware.updateDiscussionWithChannelConnections(
    async () => ({ id: "discussion" }),
    null,
    {
      where: { id: "discussion" },
      discussionUpdateInput: { body: "New body" },
      channelConnections: ["new-forum"],
      channelDisconnections: ["old-forum"],
    },
    context,
    {} as never
  );

  assert.deepEqual(calls.map(call => call.channelUniqueName), ["new-forum"]);
});

test("dispatches edited discussions through the deferred queue path", async () => {
  const modes: unknown[] = [];
  const after = {
    ...OLD,
    body: "New body",
    DiscussionChannels: [{ channelUniqueName: "cats" }],
  };
  const { context, middleware } = setup({
    snapshots: [OLD, after],
    trigger: async (_args, options) => {
      modes.push(options?.execution);
      return [];
    },
  });

  await middleware.updateDiscussions(
    async () => RESULT,
    null,
    { where: { id: "discussion" }, update: { body: "New body" } },
    context,
    {} as never
  );

  assert.deepEqual(modes, [{ deferExecution: true }]);
});

test("skips metadata-only updates without reading discussion snapshots", async () => {
  const { calls, context, middleware, reads } = setup();

  const result = await middleware.updateDiscussions(
    async () => RESULT,
    null,
    { where: { id: "discussion" }, update: { pinned: true } },
    context,
    {} as never
  );

  assert.deepEqual({ result, calls, reads: reads() }, { result: RESULT, calls: [], reads: 0 });
});

test("skips text updates that do not change moderated content", async () => {
  const { calls, context, middleware, reads } = setup();

  await middleware.updateDiscussions(
    async () => RESULT,
    null,
    {
      where: { id: "discussion" },
      update: { title: OLD.title, body: OLD.body },
    },
    context,
    {} as never
  );

  assert.deepEqual({ calls, reads: reads() }, { calls: [], reads: 1 });
});

test("does not dispatch when the discussion update fails", async () => {
  const { calls, context, middleware, reads } = setup();

  await assert.rejects(
    middleware.updateDiscussions(
      async () => { throw new Error("update failed"); },
      null,
      { where: { id: "discussion" }, update: { body: "New body" } },
      context,
      {} as never
    ),
    /update failed/
  );
  assert.deepEqual({ calls, reads: reads() }, { calls: [], reads: 1 });
});

test("keeps dispatching remaining forums after one plugin failure", async () => {
  const attempted: string[] = [];
  const after = {
    ...OLD,
    body: "New body",
    DiscussionChannels: [
      { channelUniqueName: "cats" },
      { channelUniqueName: "dogs" },
    ],
  };
  const { context, middleware } = setup({
    snapshots: [OLD, after],
    trigger: async ({ channelUniqueName }) => {
      attempted.push(channelUniqueName);
      if (channelUniqueName === "cats") throw new Error("cats unavailable");
      return [];
    },
  });

  const result = await middleware.updateDiscussions(
    async () => RESULT,
    null,
    { where: { id: "discussion" }, update: { body: "New body" } },
    context,
    {} as never
  );

  assert.deepEqual({ result, attempted }, { result: RESULT, attempted: ["cats", "dogs"] });
});

test("falls back to dispatching when the pre-update snapshot cannot be read", async () => {
  const calls: string[] = [];
  let reads = 0;
  const repository = {
    findMentionSnapshot: async () => {
      reads += 1;
      if (reads === 1) throw new Error("temporary read failure");
      return [{ ...OLD, DiscussionChannels: [{ channelUniqueName: "cats" }] }];
    },
  };
  const middleware = createDiscussionPluginPipelineMiddleware(async args => {
    calls.push(args.channelUniqueName);
    return [];
  }).Mutation;

  await middleware.updateDiscussions(
    async () => RESULT,
    null,
    { where: { id: "discussion" }, update: { body: "New body" } },
    { driver: {}, discussionRevisionRepository: repository } as never,
    {} as never
  );

  assert.deepEqual({ calls, reads }, { calls: ["cats"], reads: 2 });
});

test("returns the mutation result when the final forum lookup fails", async () => {
  let reads = 0;
  const repository = {
    findMentionSnapshot: async () => {
      reads += 1;
      if (reads === 2) throw new Error("post-update read failure");
      return [OLD];
    },
  };
  const calls: unknown[] = [];
  const middleware = createDiscussionPluginPipelineMiddleware(async args => {
    calls.push(args);
    return [];
  }).Mutation;

  const result = await middleware.updateDiscussions(
    async () => RESULT,
    null,
    { where: { id: "discussion" }, update: { body: "New body" } },
    { driver: {}, discussionRevisionRepository: repository } as never,
    {} as never
  );

  assert.deepEqual({ result, calls }, { result: RESULT, calls: [] });
});

test("passes through text updates without an exact id or driver", async () => {
  const calls: unknown[] = [];
  const middleware = createDiscussionPluginPipelineMiddleware(async args => {
    calls.push(args);
    return [];
  }).Mutation;

  await middleware.updateDiscussions(
    async () => RESULT,
    null,
    { where: {}, update: { body: "New body" } },
    { driver: {} } as never,
    {} as never
  );
  await middleware.updateDiscussions(
    async () => RESULT,
    null,
    { where: { id: "discussion" }, update: { body: "New body" } },
    {} as never,
    {} as never
  );

  assert.deepEqual(calls, []);
});
