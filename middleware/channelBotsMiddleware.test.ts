// Unit tests for the pure helpers in the channel-bots middleware: settings JSON
// parsing and bot-plugin detection. The middleware's DB orchestration is not
// exercised here (it runs through the live graphql-middleware layer).
import assert from "node:assert/strict";
import test from "node:test";
import { parseSettingsJson, isBotPlugin } from "./channelBotsMiddleware.js";

test("parseSettingsJson parses a JSON string", () => {
  assert.deepEqual(parseSettingsJson('{"a":1,"b":"x"}'), { a: 1, b: "x" });
});

test("parseSettingsJson returns {} for invalid JSON", () => {
  assert.deepEqual(parseSettingsJson("{not json"), {});
});

test("parseSettingsJson returns {} for empty/null/undefined", () => {
  assert.deepEqual(parseSettingsJson(""), {});
  assert.deepEqual(parseSettingsJson(null), {});
  assert.deepEqual(parseSettingsJson(undefined), {});
});

test("parseSettingsJson passes a non-string object through unchanged", () => {
  const obj = { already: "parsed" };
  assert.equal(parseSettingsJson(obj), obj);
});

test("isBotPlugin detects bot tags case-insensitively", () => {
  assert.equal(isBotPlugin({ tags: ["bot"] }), true);
  assert.equal(isBotPlugin({ tags: ["BOTS"] }), true);
  assert.equal(isBotPlugin({ tags: ["ai", "Bot"] }), true);
});

test("isBotPlugin is false for non-bot, missing, or malformed tags", () => {
  assert.equal(isBotPlugin({ tags: ["ai", "summarizer"] }), false);
  assert.equal(isBotPlugin({ tags: [] }), false);
  assert.equal(isBotPlugin({ tags: "bot" }), false); // not an array
  assert.equal(isBotPlugin({}), false);
  assert.equal(isBotPlugin(null), false);
  assert.equal(isBotPlugin(undefined), false);
});
