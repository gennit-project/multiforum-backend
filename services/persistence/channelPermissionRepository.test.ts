import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  CHANNEL_AUTHORIZATION_SNAPSHOT_QUERY,
  MOD_CHANNEL_SUSPENSION_QUERY,
  USER_CHANNEL_SUSPENSION_QUERY,
  createChannelPermissionRepository,
} from "./channelPermissionRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

test("loads and normalizes a leader-routed authorization snapshot", async () => {
  const configs: unknown[] = [];
  const calls: Array<{ query: string; parameters: unknown }> = [];
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      configs.push(config);
      return {
        async run(query: string, parameters: unknown) {
          calls.push({ query, parameters });
          return {
            records: [
              record({
                channel: {
                  locked: true,
                  Admins: [{ username: "alice" }],
                  Moderators: [{ displayName: "Mod A" }],
                  DefaultChannelRole: { canCreateComment: true },
                  DefaultModRole: { canReport: false },
                },
              }),
            ],
          };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createChannelPermissionRepository(driver, "permission-db");

  assert.deepEqual(await repository.findAuthorizationSnapshot("cats"), {
    locked: true,
    Admins: [{ username: "alice" }],
    Moderators: [{ displayName: "Mod A" }],
    DefaultChannelRole: { canCreateComment: true },
    DefaultModRole: { canReport: false },
  });
  assert.deepEqual(configs, [
    {
      database: "permission-db",
      defaultAccessMode: neo4j.session.WRITE,
    },
  ]);
  assert.deepEqual(calls, [
    {
      query: CHANNEL_AUTHORIZATION_SNAPSHOT_QUERY,
      parameters: { channelUniqueName: "cats" },
    },
  ]);
  assert.equal(closeCalls, 1);
});

test("returns null when the channel is missing", async () => {
  const driver = {
    session() {
      return {
        async run() {
          return { records: [] };
        },
        async close() {},
      };
    },
  } as unknown as Driver;

  const repository = createChannelPermissionRepository(driver);
  assert.equal(await repository.findAuthorizationSnapshot("missing"), null);
});

test("loads user and mod suspensions sequentially in one session", async () => {
  const calls: Array<{ query: string; parameters: unknown }> = [];
  let queryInProgress = false;
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      assert.deepEqual(config, {
        database: "permission-db",
        defaultAccessMode: neo4j.session.WRITE,
      });
      return {
        async run(query: string, parameters: unknown) {
          assert.equal(queryInProgress, false);
          queryInProgress = true;
          calls.push({ query, parameters });
          await Promise.resolve();
          queryInProgress = false;
          return {
            records: [
              record({
                suspension:
                  query === USER_CHANNEL_SUSPENSION_QUERY
                    ? {
                        id: "user-1",
                        RelatedIssue: {
                          id: "issue-1",
                          issueNumber: neo4j.int(12),
                        },
                      }
                    : { id: "mod-1" },
              }),
            ],
          };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createChannelPermissionRepository(driver, "permission-db");

  assert.deepEqual(
    await repository.findTargetedSuspensions({
      channelUniqueName: "cats",
      username: "alice",
      modProfileName: "Mod A",
    }),
    {
      userSuspensions: [
        {
          id: "user-1",
          RelatedIssue: { id: "issue-1", issueNumber: 12 },
        },
      ],
      modSuspensions: [{ id: "mod-1" }],
    }
  );
  assert.deepEqual(calls, [
    {
      query: USER_CHANNEL_SUSPENSION_QUERY,
      parameters: { channelUniqueName: "cats", username: "alice" },
    },
    {
      query: MOD_CHANNEL_SUSPENSION_QUERY,
      parameters: { channelUniqueName: "cats", modProfileName: "Mod A" },
    },
  ]);
  assert.equal(closeCalls, 1);
});

test("skips absent suspension targets and closes after a query failure", async () => {
  let runCalls = 0;
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async run() {
          runCalls += 1;
          throw new Error("read failed");
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createChannelPermissionRepository(driver);

  assert.deepEqual(
    await repository.findTargetedSuspensions({ channelUniqueName: "cats" }),
    { userSuspensions: [], modSuspensions: [] }
  );
  assert.equal(runCalls, 0);
  assert.equal(closeCalls, 1);

  await assert.rejects(
    repository.findTargetedSuspensions({
      channelUniqueName: "cats",
      username: "alice",
    }),
    /read failed/
  );
  assert.equal(closeCalls, 2);
});
