// Unit tests for the comment bot-mention middleware. Before createComments runs,
// it normalizes each input's `botMentions`: left untouched if already set, forced
// to null for non-discussion comments (feedback, event/issue, or feedback-target
// comments), and otherwise derived from the text via parseBotMentions. These
// tests drive that per-input branching and the array-passthrough guard with a
// stubbed resolver. No DB, no OGM.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./commentMentionsMiddleware.js";

const M: any = (middleware as any).Mutation;

// Capture the args the resolver ultimately receives so we can assert the
// middleware's rewrite of args.input.
function spyResolve() {
  const state: { calls: number; args: any } = { calls: 0, args: undefined };
  const resolve = async (_p: unknown, args: any) => {
    state.calls += 1;
    state.args = args;
    return { comments: [] };
  };
  return { resolve, state };
}

const ctx = {} as any;
const run = async (args: any) => {
  const { resolve, state } = spyResolve();
  const out = await M.createComments(resolve, null, args, ctx, {});
  return { out, state };
};

test("passes through untouched when args.input is not an array", async () => {
  const { state } = await run({ input: undefined });
  assert.equal(state.calls, 1);
  assert.deepEqual(state.args, { input: undefined });
});

test("leaves an input alone when botMentions is already set", async () => {
  const input = { DiscussionChannel: { connect: {} }, text: "hey @bot", botMentions: "[]" };
  const { state } = await run({ input: [input] });
  assert.equal(state.args.input[0].botMentions, "[]"); // unchanged
});

test("forces botMentions to null for a non-discussion comment (no DiscussionChannel)", async () => {
  const { state } = await run({ input: [{ text: "@bot hello" }] });
  assert.equal(state.args.input[0].botMentions, null);
});

test("forces botMentions to null for feedback / event / issue / feedback-target comments", async () => {
  const cases = [
    { DiscussionChannel: { connect: {} }, isFeedbackComment: true, text: "@bot" },
    { DiscussionChannel: { connect: {} }, Event: { connect: {} }, text: "@bot" },
    { DiscussionChannel: { connect: {} }, Issue: { connect: {} }, text: "@bot" },
    { DiscussionChannel: { connect: {} }, GivesFeedbackOnComment: { connect: {} }, text: "@bot" },
    { DiscussionChannel: { connect: {} }, GivesFeedbackOnDiscussion: { connect: {} }, text: "@bot" },
    { DiscussionChannel: { connect: {} }, GivesFeedbackOnEvent: { connect: {} }, text: "@bot" },
  ];
  const { state } = await run({ input: cases });
  for (const out of state.args.input) {
    assert.equal(out.botMentions, null);
  }
});

test("derives botMentions from the text for a plain discussion comment with mentions", async () => {
  const { state } = await run({
    input: [{ DiscussionChannel: { connect: {} }, text: "hey /bot/summarizer please run" }],
  });
  const bot = state.args.input[0].botMentions;
  assert.ok(
    typeof bot === "string" && bot.includes("summarizer"),
    `expected a serialized mention, got ${bot}`
  );
});

test("sets botMentions to null for a discussion comment with no mentions", async () => {
  const { state } = await run({
    input: [{ DiscussionChannel: { connect: {} }, text: "no mentions here" }],
  });
  assert.equal(state.args.input[0].botMentions, null);
});
