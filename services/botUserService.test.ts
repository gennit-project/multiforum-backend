import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBotUsername,
  getProfilesFromSettings,
  getBotNameFromSettings,
} from "./botUserService.js";

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

// --- getProfilesFromSettings ---

test("reads profiles from server.profiles", () => {
  assert.deepEqual(
    getProfilesFromSettings({ server: { profiles: [{ id: "a", label: "A" }] } }),
    [{ id: "a", label: "A" }]
  );
});

test("falls back to root profiles and defaults a missing label to null", () => {
  assert.deepEqual(getProfilesFromSettings({ profiles: [{ id: "b" }] }), [
    { id: "b", label: null },
  ]);
});

test("prefers server.profiles over root profiles", () => {
  assert.deepEqual(
    getProfilesFromSettings({
      server: { profiles: [{ id: "s" }] },
      profiles: [{ id: "r" }],
    }),
    [{ id: "s", label: null }]
  );
});

test("falls back to profilesJson when no profiles array is present", () => {
  assert.deepEqual(
    getProfilesFromSettings({ profilesJson: '[{"id":"c","label":"C"}]' }),
    [{ id: "c", label: "C" }]
  );
});

test("accepts a JSON string for the whole settings blob", () => {
  assert.deepEqual(getProfilesFromSettings('{"profiles":[{"id":"e"}]}'), [
    { id: "e", label: null },
  ]);
});

test("drops entries without a string id and trims the id", () => {
  assert.deepEqual(
    getProfilesFromSettings({
      profiles: [{ id: "  f  " }, { label: "no id" }, { id: 123 }],
    }),
    [{ id: "f", label: null }]
  );
});

test("returns an empty array for unparseable or empty settings", () => {
  assert.deepEqual(getProfilesFromSettings(null), []);
  assert.deepEqual(getProfilesFromSettings("not json"), []);
});

// --- getBotNameFromSettings ---

test("reads botName from the root, preferring it over server", () => {
  assert.equal(getBotNameFromSettings({ botName: "Root", server: { botName: "Srv" } }), "Root");
});

test("falls back to server.botName", () => {
  assert.equal(getBotNameFromSettings({ server: { botName: "Helper" } }), "Helper");
});

test("trims the bot name and treats blank as null", () => {
  assert.equal(getBotNameFromSettings({ botName: "  Bot  " }), "Bot");
  assert.equal(getBotNameFromSettings({ botName: "   " }), null);
});

test("returns null when no bot name is present", () => {
  assert.equal(getBotNameFromSettings({}), null);
  assert.equal(getBotNameFromSettings(null), null);
});

test("accepts a JSON string for the settings blob", () => {
  assert.equal(getBotNameFromSettings('{"botName":"FromString"}'), "FromString");
});
