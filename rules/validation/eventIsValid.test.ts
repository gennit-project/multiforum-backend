import test from "node:test";
import assert from "node:assert/strict";
import {
  validateEventInput,
  validateEventChannelsEnabled,
} from "./eventIsValid.js";
import {
  MAX_CHARS_IN_EVENT_TITLE,
  MAX_CHARS_IN_EVENT_DESCRIPTION,
} from "./constants.js";
import { makeOgm } from "../../tests/fixtures/index.js";
import type { GraphQLContext } from "../../types/context.js";

// --- validateEventInput (pure) ---

test("accepts a valid event create input", () => {
  assert.equal(
    validateEventInput({ title: "Meetup", description: "Fun" }, true),
    true
  );
});

test("requires a title on create", () => {
  assert.equal(
    validateEventInput({ title: null }, true),
    "A title is required."
  );
});

test("does not require a title on update", () => {
  assert.equal(validateEventInput({ title: null }, false), true);
});

test("rejects a title over the length limit", () => {
  const title = "a".repeat(MAX_CHARS_IN_EVENT_TITLE + 1);
  assert.equal(
    validateEventInput({ title }, true),
    `The event title cannot exceed ${MAX_CHARS_IN_EVENT_TITLE} characters.`
  );
});

test("rejects a description over the length limit", () => {
  const description = "a".repeat(MAX_CHARS_IN_EVENT_DESCRIPTION + 1);
  assert.equal(
    validateEventInput({ title: "Meetup", description }, true),
    `The event description cannot exceed ${MAX_CHARS_IN_EVENT_DESCRIPTION} characters.`
  );
});

test("accepts a valid virtual event URL", () => {
  assert.equal(
    validateEventInput(
      { title: "Meetup", virtualEventUrl: "https://example.com/call" },
      true
    ),
    true
  );
});

test("rejects an invalid virtual event URL", () => {
  assert.equal(
    validateEventInput(
      { title: "Meetup", virtualEventUrl: "not a url" },
      true
    ),
    "The virtual event URL is not a valid URL."
  );
});

test("rejects a URL without a protocol", () => {
  assert.equal(
    validateEventInput({ title: "Meetup", virtualEventUrl: "example.com" }, true),
    "The virtual event URL is not a valid URL."
  );
});

// --- validateEventChannelsEnabled (async, OGM-backed) ---

const channelOgm = (channels: Record<string, { eventsEnabled?: boolean }>) =>
  makeOgm({
    Channel: {
      find: async ({ where }: { where: { uniqueName: string } }) => {
        const channel = channels[where.uniqueName];
        return channel ? [{ uniqueName: where.uniqueName, ...channel }] : [];
      },
    },
  }).ogm;

test("passes when events are enabled in every channel", async () => {
  const ctx = {
    ogm: channelOgm({ cats: { eventsEnabled: true }, dogs: {} }),
  } as unknown as GraphQLContext;
  assert.equal(await validateEventChannelsEnabled(["cats", "dogs"], ctx), true);
});

test("fails when a channel is not found", async () => {
  const ctx = {
    ogm: channelOgm({ cats: { eventsEnabled: true } }),
  } as unknown as GraphQLContext;
  assert.equal(
    await validateEventChannelsEnabled(["ghost"], ctx),
    "Channel 'ghost' not found."
  );
});

test("fails when events are disabled in a channel", async () => {
  const ctx = {
    ogm: channelOgm({ cats: { eventsEnabled: false } }),
  } as unknown as GraphQLContext;
  assert.equal(
    await validateEventChannelsEnabled(["cats"], ctx),
    "Events are disabled in channel 'cats'."
  );
});
