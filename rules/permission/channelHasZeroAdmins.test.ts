import test from "node:test";
import assert from "node:assert/strict";
import { channelHasZeroAdmins } from "./channelHasZeroAdmins.js";
import { makeOgm } from "../../tests/fixtures/index.js";
import type { GraphQLContext } from "../../types/context.js";

const contextWith = (find: (...args: any[]) => Promise<any>) =>
  ({
    ogm: makeOgm({ Channel: { find } }).ogm,
  }) as unknown as GraphQLContext;

test("returns true when the channel has no admins", async () => {
  const context = contextWith(async () => [{ Admins: [] }]);
  assert.equal(
    await channelHasZeroAdmins({ channelName: "cats", context }),
    true
  );
});

test("returns false when the channel has admins", async () => {
  const context = contextWith(async () => [{ Admins: [{ username: "alice" }] }]);
  assert.equal(
    await channelHasZeroAdmins({ channelName: "cats", context }),
    false
  );
});

test("treats a missing Admins field as zero admins", async () => {
  const context = contextWith(async () => [{}]);
  assert.equal(
    await channelHasZeroAdmins({ channelName: "cats", context }),
    true
  );
});

test("returns false when the channel does not exist", async () => {
  const context = contextWith(async () => []);
  assert.equal(
    await channelHasZeroAdmins({ channelName: "ghost", context }),
    false
  );
});

test("returns false (and does not throw) when the lookup errors", async () => {
  const context = contextWith(async () => {
    throw new Error("db down");
  });
  assert.equal(
    await channelHasZeroAdmins({ channelName: "cats", context }),
    false
  );
});
