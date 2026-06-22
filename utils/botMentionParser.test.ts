import test from "node:test";
import assert from "node:assert/strict";
import { parseBotMentions } from "./botMentionParser.js";

test("returns an empty array for empty input", () => {
  assert.deepEqual(parseBotMentions(null), []);
  assert.deepEqual(parseBotMentions(undefined), []);
  assert.deepEqual(parseBotMentions(""), []);
});

test("parses a single bot mention without a profile id", () => {
  assert.deepEqual(parseBotMentions("hey /bot/summarizer please help"), [
    { handle: "summarizer", profileId: null, raw: "/bot/summarizer" },
  ]);
});

test("parses a bot mention with a profile id", () => {
  assert.deepEqual(parseBotMentions("/bot/summarizer:abc123"), [
    { handle: "summarizer", profileId: "abc123", raw: "/bot/summarizer:abc123" },
  ]);
});

test("parses a mention at the very start of the text", () => {
  assert.deepEqual(parseBotMentions("/bot/helper go"), [
    { handle: "helper", profileId: null, raw: "/bot/helper" },
  ]);
});

test("parses multiple distinct mentions", () => {
  const result = parseBotMentions("/bot/alpha and /bot/beta:p2");
  assert.deepEqual(result, [
    { handle: "alpha", profileId: null, raw: "/bot/alpha" },
    { handle: "beta", profileId: "p2", raw: "/bot/beta:p2" },
  ]);
});

test("deduplicates identical handle + profile id pairs", () => {
  const result = parseBotMentions("/bot/alpha /bot/alpha /bot/alpha:p1");
  assert.deepEqual(result, [
    { handle: "alpha", profileId: null, raw: "/bot/alpha" },
    // Same handle but a different profile id is a distinct mention.
    { handle: "alpha", profileId: "p1", raw: "/bot/alpha:p1" },
  ]);
});

test("requires the mention to start at a word boundary", () => {
  // Embedded in a larger token (preceded by a non-space) — not a mention.
  assert.deepEqual(parseBotMentions("email/bot/nope"), []);
});

test("allows lowercase letters, digits, and hyphens in the handle", () => {
  assert.deepEqual(parseBotMentions("/bot/my-bot-2"), [
    { handle: "my-bot-2", profileId: null, raw: "/bot/my-bot-2" },
  ]);
});

test("is stable across repeated calls (regex lastIndex is reset)", () => {
  const text = "/bot/alpha";
  const expected = [{ handle: "alpha", profileId: null, raw: "/bot/alpha" }];
  assert.deepEqual(parseBotMentions(text), expected);
  assert.deepEqual(parseBotMentions(text), expected);
});
