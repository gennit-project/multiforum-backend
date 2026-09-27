import assert from "node:assert/strict";
import test from "node:test";
import { GraphQLError } from "graphql";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePagination,
} from "./pagination.js";

test("normalizePagination supplies safe defaults", () => {
  assert.deepEqual(normalizePagination({}), {
    offset: 0,
    limit: DEFAULT_PAGE_SIZE,
  });
});

test("normalizePagination accepts GraphQL numbers and legacy numeric strings", () => {
  assert.deepEqual(normalizePagination({ offset: "20", limit: 50 }), {
    offset: 20,
    limit: 50,
  });
});

test("normalizePagination rejects limits above the hard maximum", () => {
  assert.throws(
    () => normalizePagination({ limit: MAX_PAGE_SIZE + 1 }),
    (error) =>
      error instanceof GraphQLError &&
      error.extensions.code === "BAD_USER_INPUT"
  );
});

test("normalizePagination rejects negative offsets", () => {
  assert.throws(
    () => normalizePagination({ offset: -1 }),
    /offset must be a non-negative integer/
  );
});
