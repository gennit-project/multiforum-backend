import test from "node:test";
import assert from "node:assert/strict";
import { buildBotUsername } from "./botUserService.js";

test("builds a username from channel and bot name", () => {
  assert.equal(buildBotUsername("cats", "summarizer"), "bot-cats-summarizer");
});

test("appends a normalized profile id when provided", () => {
  assert.equal(
    buildBotUsername("cats", "summarizer", "p1"),
    "bot-cats-summarizer-p1"
  );
});

test("lowercases and replaces whitespace with hyphens", () => {
  assert.equal(
    buildBotUsername("My Cats", "Cool Bot"),
    "bot-my-cats-cool-bot"
  );
});

test("replaces unsafe characters and collapses repeated hyphens", () => {
  assert.equal(buildBotUsername("My Cats!!!", "a@@@b"), "bot-my-cats-a-b");
});

test("trims leading and trailing separators after normalization", () => {
  assert.equal(buildBotUsername("--cats--", "__bot__"), "bot-cats-bot");
});

test("preserves digits, underscores, and hyphens", () => {
  assert.equal(
    buildBotUsername("cats_2", "my-bot-3"),
    "bot-cats_2-my-bot-3"
  );
});

test("throws when the channel name normalizes to empty", () => {
  assert.throws(
    () => buildBotUsername("!!!", "summarizer"),
    /channelUniqueName must match/
  );
});

test("throws when the bot name normalizes to empty", () => {
  assert.throws(
    () => buildBotUsername("cats", "@@@"),
    /botName must match/
  );
});

test("throws when a provided profile id normalizes to empty", () => {
  assert.throws(
    () => buildBotUsername("cats", "summarizer", "***"),
    /profileId must match/
  );
});

test("ignores a null or empty profile id", () => {
  assert.equal(buildBotUsername("cats", "summarizer", null), "bot-cats-summarizer");
  assert.equal(buildBotUsername("cats", "summarizer", ""), "bot-cats-summarizer");
});
