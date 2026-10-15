import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import {
  CREATE_SUSPENSION_BLOCK_NOTIFICATION_QUERY,
  DISCONNECT_EXPIRED_CHANNEL_SUSPENSIONS_QUERY,
  DISCONNECT_EXPIRED_SERVER_SUSPENSIONS_QUERY,
  createSuspensionEffectsRepository,
} from "./suspensionEffectsRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

test("uses parameterized cleanup queries with an explicit database", async () => {
  const calls: Array<{
    query: string;
    parameters: unknown;
    config: unknown;
  }> = [];
  const driver = {
    async executeQuery(query: string, parameters: unknown, config: unknown) {
      calls.push({ query, parameters, config });
      return { records: [] };
    },
  } as unknown as Driver;
  const repository = createSuspensionEffectsRepository(driver, "effects-db");

  await repository.disconnectExpiredChannelSuspensions({
    scopeName: "gardening",
    userSuspensionIds: ["user-1"],
    modSuspensionIds: ["mod-1"],
  });
  await repository.disconnectExpiredServerSuspensions({
    scopeName: "Community Forum",
    userSuspensionIds: [],
    modSuspensionIds: ["server-mod-1"],
  });

  assert.deepEqual(calls, [
    {
      query: DISCONNECT_EXPIRED_CHANNEL_SUSPENSIONS_QUERY,
      parameters: {
        scopeName: "gardening",
        userSuspensionIds: ["user-1"],
        modSuspensionIds: ["mod-1"],
      },
      config: { database: "effects-db" },
    },
    {
      query: DISCONNECT_EXPIRED_SERVER_SUSPENSIONS_QUERY,
      parameters: {
        scopeName: "Community Forum",
        userSuspensionIds: [],
        modSuspensionIds: ["server-mod-1"],
      },
      config: { database: "effects-db" },
    },
  ]);
});

test("returns the notification outcome", async () => {
  const calls: unknown[] = [];
  const driver = {
    async executeQuery(query: string, parameters: unknown, config: unknown) {
      calls.push({ query, parameters, config });
      return { records: [record({ status: "created" })] };
    },
  } as unknown as Driver;

  const status = await createSuspensionEffectsRepository(
    driver,
    "effects-db"
  ).createBlockNotification({
    username: "alice",
    text: "Suspended.",
  });

  assert.equal(status, "created");
  assert.deepEqual(calls, [
    {
      query: CREATE_SUSPENSION_BLOCK_NOTIFICATION_QUERY,
      parameters: { username: "alice", text: "Suspended." },
      config: { database: "effects-db" },
    },
  ]);
});

test("reports a missing user when the query returns no record", async () => {
  const driver = {
    async executeQuery() {
      return { records: [] };
    },
  } as unknown as Driver;

  const status = await createSuspensionEffectsRepository(
    driver
  ).createBlockNotification({ username: "missing", text: "Suspended." });

  assert.equal(status, "user-not-found");
});
