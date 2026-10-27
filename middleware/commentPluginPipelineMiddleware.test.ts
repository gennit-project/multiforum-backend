// Unit tests for the comment plugin-pipeline middleware. After createComments
// runs, it fires triggerPluginRunsForComment for each created comment (the
// trigger itself, and its persistence, are tested separately). These tests drive
// the middleware's wiring — the driver guard, the missing-id skip, the
// per-comment dispatch, and the error path that swallows failures and still
// returns the resolver result — with a stubbed resolver and a minimal context.
import assert from "node:assert/strict";
import test from "node:test";
import middleware, { createCommentPluginPipelineMiddleware } from "./commentPluginPipelineMiddleware.js";

const M: any = (middleware as any).Mutation;

// Build a ctx with a driver by default. Pass `driver: null` to exercise the
// driver guard. The real trigger resolves persistence through driver-backed
// repositories, so a placeholder driver makes the dispatch path throw, which the
// middleware swallows — the observable contract here is the returned result.
function makeCtx(opts: { driver?: unknown } = {}) {
  const driver = "driver" in opts ? opts.driver : {};
  return { ctx: { driver, user: { username: "alice" } } as any };
}

function resolveReturning(result: unknown) {
  const state = { calls: 0 };
  const resolve = async () => {
    state.calls += 1;
    return result;
  };
  return { resolve, state };
}

test("dispatches the trigger for each created comment and returns the resolver result", async () => {
  const { buildSchema } = await import("graphql");
  const { registerGeneratedSchema } = await import("../services/persistence/generatedSchemaOperations.js");
  // Register a minimal generated schema on the stub driver so the driver-backed
  // trigger resolves findComment. The resolver records which comment ids were
  // looked up (proving per-comment dispatch) and returns a non-discussion comment
  // so each trigger invocation exits fast without reaching the plugin-run path.
  const dispatched: string[] = [];
  const schema = buildSchema(`
    type User { username: String displayName: String isBot: Boolean }
    type ModerationProfile { displayName: String User: User }
    union CommentAuthor = User | ModerationProfile
    type Discussion { id: ID title: String body: String }
    type DiscussionChannel { id: ID discussionId: String channelUniqueName: String Discussion: Discussion }
    type Channel { uniqueName: String displayName: String description: String rules: String }
    type EventChannel { channelUniqueName: String }
    type Event { id: ID title: String EventChannels: [EventChannel] }
    type Issue { id: ID }
    type ParentComment { id: ID }
    type Comment { id: ID text: String botMentions: [String] isFeedbackComment: Boolean createdAt: String CommentAuthor: CommentAuthor DiscussionChannel: DiscussionChannel Channel: Channel Event: Event Issue: Issue ParentComment: ParentComment }
    input CommentIdWhere { eq: ID }
    input CommentWhere { id: CommentIdWhere }
    type Query { comments(where: CommentWhere): [Comment] }
  `);
  schema.getQueryType()!.getFields().comments.resolve = (_parent: unknown, { where }: { where?: { id?: { eq?: string } } }) => {
    const id = where?.id?.eq;
    dispatched.push(id as string);
    return [{ id, isFeedbackComment: false, botMentions: [], DiscussionChannel: null, Channel: null, Event: null, Issue: null, CommentAuthor: null, ParentComment: null }];
  };
  const driver = {} as any;
  registerGeneratedSchema(driver, schema);

  const ctx = { driver, user: { username: "alice" } } as any;
  const { resolve, state } = resolveReturning({ comments: [{ id: "c-1" }, { id: "c-2" }] });
  const out = await M.createCommentWithOwnedConnections(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{ id: "c-1" }, { id: "c-2" }] });
  assert.equal(state.calls, 1);
  // The middleware dispatched the trigger once per created comment, in order.
  assert.deepEqual(dispatched, ["c-1", "c-2"]);
});

test("no created comments -> returns the result without dispatching", async () => {
  const { ctx } = makeCtx();
  const { resolve, state } = resolveReturning({ comments: [] });
  const out = await M.createCommentWithOwnedConnections(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [] });
  assert.equal(state.calls, 1);
});

test("undefined result is returned unchanged", async () => {
  const { ctx } = makeCtx();
  const { resolve } = resolveReturning(undefined);
  const out = await M.createCommentWithOwnedConnections(resolve, null, {}, ctx, {});
  assert.equal(out, undefined);
});

test("returns early when the driver is unavailable", async () => {
  const { ctx } = makeCtx({ driver: null });
  const { resolve, state } = resolveReturning({ comments: [{ id: "c-1" }] });
  const out = await M.createCommentWithOwnedConnections(resolve, null, {}, ctx, {});
  // Guard short-circuits before any dispatch, returning the resolver result as-is.
  assert.deepEqual(out, { comments: [{ id: "c-1" }] });
  assert.equal(state.calls, 1);
});

test("comments without an id are skipped", async () => {
  const { ctx } = makeCtx();
  const { resolve } = resolveReturning({ comments: [{}] });
  const out = await M.createCommentWithOwnedConnections(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{}] });
});

test("a failure while dispatching is swallowed and the result still returns", async () => {
  // The placeholder driver makes the trigger's repository lookups throw; the
  // middleware catches the failure and still returns the resolver result.
  const { ctx } = makeCtx();
  const { resolve, state } = resolveReturning({ comments: [{ id: "c-1" }] });
  const out = await M.createCommentWithOwnedConnections(resolve, null, {}, ctx, {});
  assert.deepEqual(out, { comments: [{ id: "c-1" }] });
  assert.equal(state.calls, 1);
});

test("dispatches comment.edited after a successful text update", async () => {
  const calls: Array<{ commentId: string; event: string; driver: unknown }> = [];
  const executionModes: unknown[] = [];
  const injected = createCommentPluginPipelineMiddleware(async (args, options) => {
    calls.push(args);
    executionModes.push(options?.execution);
    return [];
  });
  const driver = {} as any;
  const result = { comments: [{ id: "c-1" }, { id: "c-2" }] };

  const out = await injected.Mutation.updateComments(
    async () => result,
    null,
    { update: { text: "edited text" } },
    { driver } as any,
    {} as any
  );

  assert.equal(out, result);
  assert.deepEqual(calls, [
    { commentId: "c-1", event: "comment.edited", driver },
    { commentId: "c-2", event: "comment.edited", driver },
  ]);
  assert.deepEqual(executionModes, [
    { deferExecution: true },
    { deferExecution: true },
  ]);
});

test("does not dispatch comment.edited for a non-text update", async () => {
  const calls: unknown[] = [];
  const injected = createCommentPluginPipelineMiddleware(async args => {
    calls.push(args);
    return [];
  });
  const result = { comments: [{ id: "c-1" }] };

  const out = await injected.Mutation.updateComments(
    async () => result,
    null,
    { update: { isSticky: true } },
    { driver: {} } as any,
    {} as any
  );

  assert.equal(out, result);
  assert.deepEqual(calls, []);
});

test("does not dispatch comment.edited when the update fails", async () => {
  const calls: unknown[] = [];
  const injected = createCommentPluginPipelineMiddleware(async args => {
    calls.push(args);
    return [];
  });

  await assert.rejects(
    injected.Mutation.updateComments(
      async () => { throw new Error("update failed"); },
      null,
      { update: { text: "edited text" } },
      { driver: {} } as any,
      {} as any
    ),
    /update failed/
  );
  assert.deepEqual(calls, []);
});
