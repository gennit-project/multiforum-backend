import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { SuspensionEffectsRepository } from "../../services/persistence/suspensionEffectsRepository.js";
import { disconnectExpiredSuspensions } from "./disconnectExpiredSuspensions.js";

const buildRepository = (failure?: Error) => {
  const calls: unknown[] = [];
  const repository: SuspensionEffectsRepository = {
    async disconnectExpiredChannelSuspensions(input) {
      calls.push(input);
      if (failure) throw failure;
    },
    async disconnectExpiredServerSuspensions() {},
    async createBlockNotification() {
      return "created";
    },
  };
  return { calls, repository };
};

test("disconnects user and mod suspensions through the repository", async () => {
  const { calls, repository } = buildRepository();

  const result = await disconnectExpiredSuspensions({
    driver: {} as Driver,
    repository,
    channelUniqueName: "forum-1",
    expiredUserSuspensions: [{ id: "user-1" }, { id: "user-2" }],
    expiredModSuspensions: [{ id: "mod-1" }],
  });

  assert.deepEqual(calls, [
    {
      scopeName: "forum-1",
      userSuspensionIds: ["user-1", "user-2"],
      modSuspensionIds: ["mod-1"],
    },
  ]);
  assert.deepEqual(result, {
    disconnectedUserSuspensionIds: ["user-1", "user-2"],
    disconnectedModSuspensionIds: ["mod-1"],
  });
});

test("does not call the repository when there is nothing to disconnect", async () => {
  const { calls, repository } = buildRepository();

  const result = await disconnectExpiredSuspensions({
    driver: {} as Driver,
    repository,
    channelUniqueName: "forum-1",
    expiredUserSuspensions: [],
    expiredModSuspensions: [],
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(result, {
    disconnectedUserSuspensionIds: [],
    disconnectedModSuspensionIds: [],
  });
});

test("preserves best-effort behavior when cleanup fails", async () => {
  const { repository } = buildRepository(new Error("database unavailable"));

  const result = await disconnectExpiredSuspensions({
    driver: {} as Driver,
    repository,
    channelUniqueName: "forum-1",
    expiredUserSuspensions: [{ id: "user-1" }],
    expiredModSuspensions: [],
  });

  assert.deepEqual(result, {
    disconnectedUserSuspensionIds: ["user-1"],
    disconnectedModSuspensionIds: [],
  });
});
