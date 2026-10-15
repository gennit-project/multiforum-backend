import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import type { SuspensionEffectsRepository } from "../../services/persistence/suspensionEffectsRepository.js";
import { disconnectExpiredServerSuspensions } from "./disconnectExpiredServerSuspensions.js";

const buildContext = (failure?: Error) => {
  const calls: unknown[] = [];
  const repository: SuspensionEffectsRepository = {
    async disconnectExpiredChannelSuspensions() {},
    async disconnectExpiredServerSuspensions(input) {
      calls.push(input);
      if (failure) throw failure;
    },
    async createBlockNotification() {
      return "created";
    },
  };

  return {
    calls,
    context: { suspensionEffectsRepository: repository } as GraphQLContext,
  };
};

test("disconnects server user and mod suspensions through the repository", async () => {
  const previousServerName = process.env.SERVER_CONFIG_NAME;
  process.env.SERVER_CONFIG_NAME = "test-server";
  const { calls, context } = buildContext();

  try {
    const result = await disconnectExpiredServerSuspensions({
      context,
      expiredUserSuspensions: [{ id: "user-1" }, { id: "user-2" }],
      expiredModSuspensions: [{ id: "mod-1" }],
    });

    assert.deepEqual(calls, [
      {
        scopeName: "test-server",
        userSuspensionIds: ["user-1", "user-2"],
        modSuspensionIds: ["mod-1"],
      },
    ]);
    assert.deepEqual(result, {
      disconnectedUserSuspensionIds: ["user-1", "user-2"],
      disconnectedModSuspensionIds: ["mod-1"],
    });
  } finally {
    if (previousServerName === undefined) delete process.env.SERVER_CONFIG_NAME;
    else process.env.SERVER_CONFIG_NAME = previousServerName;
  }
});

test("does not call the repository when there is nothing to disconnect", async () => {
  const { calls, context } = buildContext();

  const result = await disconnectExpiredServerSuspensions({
    context,
    expiredUserSuspensions: [],
    expiredModSuspensions: [],
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(result, {
    disconnectedUserSuspensionIds: [],
    disconnectedModSuspensionIds: [],
  });
});

test("propagates server cleanup failures", async () => {
  const failure = new Error("database unavailable");
  const { context } = buildContext(failure);

  await assert.rejects(
    disconnectExpiredServerSuspensions({
      context,
      expiredUserSuspensions: [{ id: "user-1" }],
      expiredModSuspensions: [],
    }),
    failure
  );
});
