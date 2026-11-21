import assert from "node:assert/strict";
import test from "node:test";
import getImageIdByNumber from "./getImageIdByNumber.js";
import getAlbumIdByNumber from "./getAlbumIdByNumber.js";
import getCollectionIdByNumber from "./getCollectionIdByNumber.js";
import getEventIdByNumber from "./getEventIdByNumber.js";
import getCommentIdByShortId from "./getCommentIdByShortId.js";
import type { GraphQLResolveInfo } from "graphql";

// A driver whose single session returns one row holding `id` (or no rows).
const mockDriver = (id: string | null) => {
  const calls = { closed: 0, params: null as Record<string, unknown> | null };
  return {
    calls,
    driver: {
      session: () => ({
        run: async (_cypher: string, params: Record<string, unknown>) => {
          calls.params = params;
          return { records: id === null ? [] : [{ get: () => id }] };
        },
        close: async () => {
          calls.closed += 1;
        },
      }),
    } as any,
  };
};

const ctx = {} as any;
const info = {} as GraphQLResolveInfo;

test("per-user id-by-number resolvers return the resolved id and close the session", async () => {
  for (const [make, args] of [
    [getImageIdByNumber, { username: "alice", imageNumber: 12 }],
    [getAlbumIdByNumber, { username: "alice", albumNumber: 3 }],
    [getCollectionIdByNumber, { username: "alice", collectionNumber: 5 }],
  ] as const) {
    const { driver, calls } = mockDriver("the-id");
    const result = await (make as any)({ driver })(null, args, ctx, info);
    assert.equal(result, "the-id");
    assert.equal(calls.closed, 1);
  }
});

test("event and comment lookups return the resolved id", async () => {
  const ev = mockDriver("event-1");
  assert.equal(
    await getEventIdByNumber({ driver: ev.driver })(null, { channelUniqueName: "cats", eventNumber: 7 }, ctx, info),
    "event-1"
  );
  const cm = mockDriver("comment-1");
  assert.equal(
    await getCommentIdByShortId({ driver: cm.driver })(null, { shortId: "abc123abc123" }, ctx, info),
    "comment-1"
  );
});

test("resolvers return null for a missing match", async () => {
  const { driver } = mockDriver(null);
  assert.equal(
    await getImageIdByNumber({ driver })(null, { username: "alice", imageNumber: 99 }, ctx, info),
    null
  );
});

test("resolvers short-circuit to null on missing args without opening a session", async () => {
  const { driver, calls } = mockDriver("unused");
  assert.equal(await getImageIdByNumber({ driver })(null, { username: "", imageNumber: 1 } as any, ctx, info), null);
  assert.equal(await getEventIdByNumber({ driver })(null, { channelUniqueName: "", eventNumber: 1 } as any, ctx, info), null);
  assert.equal(await getCommentIdByShortId({ driver })(null, { shortId: "" } as any, ctx, info), null);
  assert.equal(calls.closed, 0);
});
