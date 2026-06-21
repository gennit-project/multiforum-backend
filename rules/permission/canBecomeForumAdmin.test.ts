import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCanBecomeForumAdmin } from "./canBecomeForumAdmin.js";

test("allows becoming admin when the forum has zero admins", () => {
  assert.equal(
    evaluateCanBecomeForumAdmin({
      channelUniqueName: "cats",
      username: "alice",
      hasZeroAdmins: true,
    }),
    true
  );
});

test("requires a channelUniqueName", () => {
  assert.throws(
    () =>
      evaluateCanBecomeForumAdmin({
        username: "alice",
        hasZeroAdmins: true,
      }),
    /channelUniqueName is required/
  );
});

test("requires an authenticated user", () => {
  assert.throws(
    () =>
      evaluateCanBecomeForumAdmin({
        channelUniqueName: "cats",
        username: undefined,
        hasZeroAdmins: true,
      }),
    /User must be authenticated/
  );
});

test("rejects when the forum already has admins", () => {
  assert.throws(
    () =>
      evaluateCanBecomeForumAdmin({
        channelUniqueName: "cats",
        username: "alice",
        hasZeroAdmins: false,
      }),
    /this forum already has one or more admins/
  );
});

test("the missing-channel error takes precedence over other failures", () => {
  assert.throws(
    () => evaluateCanBecomeForumAdmin({ hasZeroAdmins: false }),
    /channelUniqueName is required/
  );
});
