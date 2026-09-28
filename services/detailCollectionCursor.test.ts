import assert from "node:assert/strict";
import test from "node:test";
import { GraphQLError } from "graphql";
import {
  decodeDetailCollectionCursor,
  encodeDetailCollectionCursor,
} from "./detailCollectionCursor.js";

test("detail collection cursors round trip", () => {
  const cursor = {
    kind: "image" as const,
    createdAt: "2026-01-02T03:04:05.000Z",
    id: "image-1",
  };

  assert.deepEqual(
    decodeDetailCollectionCursor({
      after: encodeDetailCollectionCursor(cursor),
      expectedKind: "image",
    }),
    cursor
  );
});

test("detail collection cursors cannot be reused for another collection", () => {
  const after = encodeDetailCollectionCursor({
    kind: "file",
    createdAt: "2026-01-02T03:04:05.000Z",
    id: "file-1",
  });

  assert.throws(
    () => decodeDetailCollectionCursor({ after, expectedKind: "answer" }),
    (error: unknown) =>
      error instanceof GraphQLError &&
      error.extensions.code === "BAD_USER_INPUT"
  );
});

test("malformed detail collection cursors are rejected", () => {
  assert.throws(
    () =>
      decodeDetailCollectionCursor({
        after: "not-a-cursor",
        expectedKind: "file",
      }),
    (error: unknown) =>
      error instanceof GraphQLError &&
      error.extensions.code === "BAD_USER_INPUT"
  );
});

