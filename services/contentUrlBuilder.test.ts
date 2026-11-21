import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import {
  discussionSegment,
  eventSegment,
  commentSegment,
  buildDiscussionUrl,
  buildDiscussionCommentUrl,
  buildEventUrl,
  buildEventCommentUrl,
  buildImageUrl,
} from "./contentUrlBuilder.js";

// A runner returning one record whose keys come from `row`; `throws` simulates a
// lookup failure (the builders must fall back to the raw id).
const runner = (row: Record<string, unknown>, throws = false) => ({
  run: async () => {
    if (throws) throw new Error("boom");
    return { records: [{ get: (k: string) => row[k] ?? null }] };
  },
});

const driverFor = (runnerImpl: { run: (...a: unknown[]) => Promise<unknown> }) => ({
  session: () => ({ run: runnerImpl.run, close: async () => {} }),
}) as any;

test("discussionSegment builds number-slug, falls back to id without a number or on error", async () => {
  assert.equal(
    await discussionSegment(runner({ number: neo4j.int(42), title: "Trail Conditions" }), "cats", "d-1"),
    "42-trail-conditions"
  );
  assert.equal(await discussionSegment(runner({ number: null, title: "x" }), "cats", "d-1"), "d-1");
  assert.equal(await discussionSegment(runner({}, true), "cats", "d-1"), "d-1");
});

test("eventSegment builds number-slug and falls back to id", async () => {
  assert.equal(await eventSegment(runner({ number: neo4j.int(7), title: "Saturday Cleanup" }), "cats", "e-1"), "7-saturday-cleanup");
  assert.equal(await eventSegment(runner({ number: null }), "cats", "e-1"), "e-1");
});

test("commentSegment uses the shortId or falls back to the id", async () => {
  assert.equal(await commentSegment(runner({ shortId: "abc123abc123" }), "c-1"), "abc123abc123");
  assert.equal(await commentSegment(runner({ shortId: null }), "c-1"), "c-1");
});

test("the URL builders compose the base, forum and segments", async () => {
  const base = "https://app.test";
  assert.equal(
    await buildDiscussionUrl(driverFor(runner({ number: neo4j.int(42), title: "Trail" })), base, "cats", "d-1"),
    "https://app.test/forums/cats/discussions/42-trail"
  );
  assert.equal(
    await buildDiscussionCommentUrl(driverFor(runner({ number: neo4j.int(42), title: "Trail", shortId: "s" })), base, "cats", "d-1", "c-1"),
    "https://app.test/forums/cats/discussions/42-trail/comments/s"
  );
  assert.equal(
    await buildEventUrl(driverFor(runner({ number: neo4j.int(7), title: "Party" })), base, "cats", "e-1"),
    "https://app.test/forums/cats/events/7-party"
  );
  assert.equal(
    await buildEventCommentUrl(driverFor(runner({ number: neo4j.int(7), title: "Party", shortId: "z" })), base, "cats", "e-1", "c-1"),
    "https://app.test/forums/cats/events/7-party/comments/z"
  );
});

test("buildImageUrl links the uploader library, number or id", async () => {
  assert.equal(
    await buildImageUrl(driverFor(runner({ number: neo4j.int(12) })), "https://app.test", "alice", "img-1"),
    "https://app.test/u/alice/images/12"
  );
  assert.equal(
    await buildImageUrl(driverFor(runner({ number: null })), "https://app.test", "alice", "img-1"),
    "https://app.test/u/alice/images/img-1"
  );
});
