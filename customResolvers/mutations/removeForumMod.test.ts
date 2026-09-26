import test from "node:test";
import assert from "node:assert/strict";
import removeForumMod from "./removeForumMod.js";

function createModels(profileName: string | null = "ModAlice") {
  const calls = { userFind: 0, update: undefined as unknown };
  const Channel = {
    update: async (input: unknown) => {
      calls.update = input;
      return { channels: [{ uniqueName: "cats" }] };
    },
  } as any;
  const User = {
    find: async () => {
      calls.userFind += 1;
      return profileName ? [{ ModerationProfile: { displayName: profileName } }] : [];
    },
  } as any;
  return { resolver: removeForumMod({ Channel, User }), calls };
}

const disconnectedProfile = (update: unknown) =>
  (update as any).update.Moderators[0].disconnect[0].where.node.displayName;

test("removes a moderator by mod-profile name", async () => {
  const { resolver, calls } = createModels();

  await resolver(undefined, { channelUniqueName: "cats", modProfileName: "ModBob" }, {} as any, {} as any);

  assert.equal(disconnectedProfile(calls.update), "ModBob");
});

test("does not look up any user account when given a mod-profile name", async () => {
  const { resolver, calls } = createModels();

  await resolver(undefined, { channelUniqueName: "cats", modProfileName: "ModBob" }, {} as any, {} as any);

  assert.equal(calls.userFind, 0);
});

test("still resolves the deprecated username argument to its mod profile", async () => {
  const { resolver, calls } = createModels("ModAlice");

  await resolver(undefined, { channelUniqueName: "cats", username: "alice" }, {} as any, {} as any);

  assert.equal(disconnectedProfile(calls.update), "ModAlice");
});

test("rejects a username that has no mod profile", async () => {
  const { resolver } = createModels(null);

  await assert.rejects(
    resolver(undefined, { channelUniqueName: "cats", username: "alice" }, {} as any, {} as any),
    /not a moderator/
  );
});

test.describe("requires exactly one moderator identifier", () => {
  for (const [label, args] of [
    ["neither", {}],
    ["both", { modProfileName: "ModBob", username: "bob" }],
  ] as const) {
    test(`rejects ${label}`, async () => {
      const { resolver } = createModels();

      await assert.rejects(
        resolver(undefined, { channelUniqueName: "cats", ...args }, {} as any, {} as any),
        /exactly one of modProfileName or username/
      );
    });
  }
});
