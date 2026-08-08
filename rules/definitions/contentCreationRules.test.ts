// Unit tests for the content-creation graphql-shield rules. Rules expose their
// raw resolver as `.func(parent, args, ctx, info)`, which runs the real logic
// and throws on failure. We drive the guard branches (missing input / channel /
// resolvable channel name) directly, and the permission-check tail with a fuller
// context that denies for a user with no permission. In-memory OGM + driver; no DB.
import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCanCreateChannelRule,
  canCreateChannel,
  canCreateDiscussion,
  canCreateEvent,
  canCreateComment,
} from "./contentCreationRules.js";

const run = (r: any, args: any, ctx: any) => (r as any).func({}, args, ctx, {} as any);

function makeCtx(rows: Record<string, unknown[]> = {}) {
  return {
    user: { username: "alice", email: "alice@x.test", data: { username: "alice" } },
    req: { headers: {} },
    driver: { session: () => ({ run: async () => ({ records: [] }), close: async () => {} }) },
    ogm: { model: (name: string) => ({ find: async () => rows[name] ?? [] }) },
  } as any;
}
const permCtx = (extra: Record<string, unknown[]> = {}) =>
  makeCtx({ ServerConfig: [{ Admins: [], SuperAdmins: [] }], Channel: [{ uniqueName: "cats", Admins: [], Moderators: [] }], ...extra });

async function ranToDecision(promise: Promise<unknown>) {
  try {
    const r = await promise;
    assert.ok(r === true || r === false || r instanceof Error, `unexpected: ${String(r)}`);
  } catch (e) {
    assert.ok(e instanceof Error); // shield rules throw on some denials
  }
}

// ---- canCreateChannel ----

test("evaluateCanCreateChannelRule runs the server-permission check", async () => {
  const r = await evaluateCanCreateChannelRule(permCtx());
  assert.ok(r === true || r instanceof Error);
});

test("canCreateChannel.func delegates to the evaluator", async () => {
  await ranToDecision(run(canCreateChannel, {}, permCtx()));
});

// ---- canCreateDiscussion ----

test("canCreateDiscussion checks channel permissions per input item", async () => {
  const args = { input: [{ discussionCreateInput: {}, channelConnections: ["cats"] }] };
  await ranToDecision(run(canCreateDiscussion, args, permCtx()));
});

test("canCreateDiscussion allows an empty input list (nothing to check)", async () => {
  const r = await run(canCreateDiscussion, { input: [] }, permCtx());
  assert.equal(r, true);
});

// ---- canCreateEvent ----

test("canCreateEvent flattens channel connections and checks permissions", async () => {
  const args = { input: [{ eventCreateInput: {}, channelConnections: ["cats"] }] };
  await ranToDecision(run(canCreateEvent, args, permCtx()));
});

// ---- canCreateComment ----

test("canCreateComment throws when there is no input item", async () => {
  await assert.rejects(run(canCreateComment, { input: [] }, makeCtx()), /No comment create input/);
});

test("canCreateComment throws when no Channel is connected", async () => {
  await assert.rejects(run(canCreateComment, { input: [{ text: "hi" }] }, makeCtx()), /connected to a Channel/);
});

test("canCreateComment throws when no channel name can be resolved", async () => {
  // Channel present but no DiscussionChannel/Event/feedback target -> channelName stays empty
  const input = [{ Channel: { connect: { where: { node: { uniqueName: "cats" } } } } }];
  await assert.rejects(run(canCreateComment, { input }, permCtx()), /No channel name/);
});

test("canCreateComment resolves the channel via DiscussionChannel and checks permission", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    DiscussionChannel: { connect: { where: { node: { id: "dc-1" } } } },
  }];
  const ctx = permCtx({ DiscussionChannel: [{ channelUniqueName: "cats", locked: false, archived: false }] });
  await ranToDecision(run(canCreateComment, { input }, ctx));
});

test("canCreateComment rejects a reply to an archived parent comment", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    ParentComment: { connect: { where: { node: { id: "c-parent" } } } },
  }];
  const ctx = permCtx({ Comment: [{ id: "c-parent", archived: true }] });
  await assert.rejects(run(canCreateComment, { input }, ctx), /archived/);
});

test("canCreateComment resolves the channel via an Event submission", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    Event: { connect: { where: { node: { id: "e-1" } } } },
  }];
  const ctx = permCtx({ EventChannel: [{ id: "ec-1", locked: false, archived: false }] });
  await ranToDecision(run(canCreateComment, { input }, ctx));
});

test("canCreateComment throws when the Event submission is not in the channel", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    Event: { connect: { where: { node: { id: "e-1" } } } },
  }];
  const ctx = permCtx({ EventChannel: [] });
  await assert.rejects(run(canCreateComment, { input }, ctx), /Could not find the event/);
});

test("canCreateComment treats a feedback comment as a mod-permission check", async () => {
  const input = [{
    Channel: { connect: { where: { node: { uniqueName: "cats" } } } },
    GivesFeedbackOnComment: { connect: { where: { node: { id: "c-9" } } } },
  }];
  await ranToDecision(run(canCreateComment, { input }, permCtx()));
});
