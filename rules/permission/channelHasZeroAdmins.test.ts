import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext, Ogm } from "../../types/context.js";
import type {
  ChannelAuthorizationSnapshot,
  ChannelPermissionRepository,
} from "../../services/persistence/channelPermissionRepository.js";
import { channelHasZeroAdmins } from "./channelHasZeroAdmins.js";

const contextWith = (
  findAuthorizationSnapshot: () => Promise<ChannelAuthorizationSnapshot | null>
): GraphQLContext => ({
  driver: {} as Driver,
  ogm: {} as Ogm,
  channelPermissionRepository: {
    findAuthorizationSnapshot,
    async findTargetedSuspensions() {
      throw new Error("unexpected suspension lookup");
    },
  } satisfies ChannelPermissionRepository,
});

const snapshot = (
  admins: ChannelAuthorizationSnapshot["Admins"]
): ChannelAuthorizationSnapshot => ({ Admins: admins, Moderators: [] });

test("returns true when the channel has no admins", async () => {
  const context = contextWith(async () => snapshot([]));
  assert.equal(
    await channelHasZeroAdmins({ channelName: "cats", context }),
    true
  );
});

test("returns false when the channel has admins", async () => {
  const context = contextWith(async () => snapshot([{ username: "alice" }]));
  assert.equal(
    await channelHasZeroAdmins({ channelName: "cats", context }),
    false
  );
});

test("returns false when the channel does not exist", async () => {
  const context = contextWith(async () => null);
  assert.equal(
    await channelHasZeroAdmins({ channelName: "ghost", context }),
    false
  );
});

test("returns false without throwing when the lookup errors", async () => {
  const context = contextWith(async () => {
    throw new Error("db down");
  });
  assert.equal(
    await channelHasZeroAdmins({ channelName: "cats", context }),
    false
  );
});
