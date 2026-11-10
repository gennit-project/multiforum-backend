import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeDiscussionListCursor,
  encodeDiscussionListCursor,
  encodeRawDiscussionListCursor,
} from "./discussionListCursor.js";

const hotCursor = {
  sort: "hot" as const,
  sortValue: 4.25,
  createdAt: "2026-09-27T12:00:00.000Z",
  discussionId: "discussion-1",
  rankingAnchor: "2026-09-27T13:00:00.000Z",
};

test("discussion cursor round trips without exposing its fields", () => {
  const encoded = encodeDiscussionListCursor(hotCursor);

  assert.deepEqual(
    decodeDiscussionListCursor({ after: encoded, expectedSort: "hot" }),
    hotCursor
  );
  assert.doesNotMatch(encoded, /discussion-1/);
});

test("new-sort cursor does not require a rank or ranking anchor", () => {
  const cursor = {
    sort: "new" as const,
    sortValue: null,
    createdAt: "2026-09-27T12:00:00.000Z",
    discussionId: "discussion-2",
    rankingAnchor: null,
  };

  assert.deepEqual(
    decodeDiscussionListCursor({
      after: encodeDiscussionListCursor(cursor),
      expectedSort: "new",
    }),
    cursor
  );
});

test("discussion cursor rejects a different active sort", () => {
  assert.throws(
    () =>
      decodeDiscussionListCursor({
        after: encodeDiscussionListCursor(hotCursor),
        expectedSort: "top",
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "after must be a valid cursor for the selected sort."
  );
});

test("discussion cursor rejects malformed input", () => {
  assert.throws(
    () =>
      decodeDiscussionListCursor({
        after: "not-a-cursor",
        expectedSort: "new",
      }),
    /after must be a valid cursor/
  );
});


test('raw source encoding retains malformed stored identity without certifying a decoded cursor',()=>{
 const encoded=encodeRawDiscussionListCursor({...hotCursor,discussionId:17});
 assert.equal(JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')).i,17);
 assert.throws(()=>decodeDiscussionListCursor({after:encoded,expectedSort:'hot'}),/valid cursor/);
});
