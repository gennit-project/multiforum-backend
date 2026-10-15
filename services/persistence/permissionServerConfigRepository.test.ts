import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  createPermissionServerConfigRepository,
  PERMISSION_SERVER_CONFIG_QUERY,
} from "./permissionServerConfigRepository.js";

test("findByName uses the configured database and leader routing", async () => {
  const sessionConfigs: unknown[] = [];
  const runCalls: unknown[][] = [];
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      sessionConfigs.push(config);
      return {
        async run(...args: unknown[]) {
          runCalls.push(args);
          return {
            records: [
              {
                get(key: string) {
                  assert.equal(key, "serverConfig");
                  return {
                    enableDownloads: true,
                    DefaultServerRole: { canCreateChannel: true },
                    SuperAdmins: [],
                    Admins: [],
                    Moderators: [],
                    SuspendedUsers: [
                      {
                        id: "suspension-1",
                        RelatedIssue: { issueNumber: neo4j.int(42) },
                      },
                    ],
                    SuspendedMods: [],
                  };
                },
              },
            ],
          };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  const repository = createPermissionServerConfigRepository(
    driver,
    "permissions-db"
  );
  const result = await repository.findByName("community");

  assert.deepEqual(sessionConfigs, [
    { database: "permissions-db", defaultAccessMode: neo4j.session.WRITE },
  ]);
  assert.deepEqual(runCalls, [
    [
      PERMISSION_SERVER_CONFIG_QUERY,
      { serverName: "community" },
    ],
  ]);
  assert.equal(closeCalls, 1);
  assert.equal(result?.SuspendedUsers[0]?.RelatedIssue?.issueNumber, 42);
});

test("findByName returns null when the server config is absent", async () => {
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

  const repository = createPermissionServerConfigRepository(driver, "neo4j");

  assert.equal(await repository.findByName(undefined), null);
});
