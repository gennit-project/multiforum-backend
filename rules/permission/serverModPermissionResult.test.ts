import test from "node:test";
import assert from "node:assert/strict";
import { normalizeServerModPermissionResult } from "./serverModPermissionResult.js";

test("passes a true result through as true", () => {
  assert.equal(normalizeServerModPermissionResult(true), true);
});

test("returns an Error result unchanged", () => {
  const err = new Error("not a mod");
  assert.equal(normalizeServerModPermissionResult(err), err);
});

test("default behavior treats a falsy non-error result as allowed", () => {
  // Mirrors canPermanentlyRemoveImage / image server-scope.
  assert.equal(normalizeServerModPermissionResult(false), true);
});

test("denyOnFalsy treats a falsy non-error result as denied", () => {
  // Mirrors canLockChannel.
  assert.equal(
    normalizeServerModPermissionResult(false, { denyOnFalsy: true }),
    false
  );
});

test("denyOnFalsy still returns an Error result unchanged", () => {
  const err = new Error("not a mod");
  assert.equal(
    normalizeServerModPermissionResult(err, { denyOnFalsy: true }),
    err
  );
});

test("denyOnFalsy still passes a true result through", () => {
  assert.equal(
    normalizeServerModPermissionResult(true, { denyOnFalsy: true }),
    true
  );
});
