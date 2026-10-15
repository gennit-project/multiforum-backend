import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import {
  CONNECT_BOOTSTRAP_ADMIN_QUERY,
  CREATE_BOOTSTRAP_IDENTITY_QUERY,
  DATABASE_HAS_USERS_QUERY,
  FIND_BOOTSTRAP_IDENTITY_QUERY,
  FIND_BOOTSTRAP_SERVER_QUERY,
  createBootstrapAdminRepository,
} from "./bootstrapAdminRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

test("reconciles a new admin in one managed transaction", async () => {
  const sessionConfigs: unknown[] = [];
  const runCalls: Array<{ query: string; parameters: unknown }> = [];
  let executeWriteCalls = 0;
  let closeCalls = 0;
  const responses = [
    {
      records: [
        record({
          userExists: false,
          emailExists: false,
          linkedEmails: [],
          linkedUsernames: [],
        }),
      ],
    },
    { records: [record({ hasUsers: false })] },
    { records: [] },
    { records: [record({ serverExists: true, alreadyConnected: false })] },
    { records: [] },
  ];
  const transaction = {
    async run(query: string, parameters?: unknown) {
      runCalls.push({ query, parameters });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  };
  const driver = {
    session(config: unknown) {
      sessionConfigs.push(config);
      return {
        async executeWrite(work: (tx: unknown) => Promise<unknown>) {
          executeWriteCalls += 1;
          return work(transaction);
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  const repository = createBootstrapAdminRepository(driver, "bootstrap-db");
  const result = await repository.reconcile({
    serverName: "Community Forum",
    email: "admin@example.test",
    username: "admin",
  });

  assert.deepEqual(result, { status: "created", username: "admin" });
  assert.deepEqual(sessionConfigs, [{ database: "bootstrap-db" }]);
  assert.equal(executeWriteCalls, 1);
  assert.equal(closeCalls, 1);
  assert.deepEqual(
    runCalls.map(({ query }) => query),
    [
      FIND_BOOTSTRAP_IDENTITY_QUERY,
      DATABASE_HAS_USERS_QUERY,
      CREATE_BOOTSTRAP_IDENTITY_QUERY,
      FIND_BOOTSTRAP_SERVER_QUERY,
      CONNECT_BOOTSTRAP_ADMIN_QUERY,
    ]
  );
  assert.deepEqual(runCalls[2]?.parameters, {
    username: "admin",
    email: "admin@example.test",
    moderationProfileName: "bootstrap-admin",
  });
});

test("closes the session when reconciliation fails", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async executeWrite(work: (tx: unknown) => Promise<unknown>) {
          return work({
            async run() {
              return {
                records: [
                  record({
                    userExists: true,
                    emailExists: false,
                    linkedEmails: ["other@example.test"],
                    linkedUsernames: [],
                  }),
                ],
              };
            },
          });
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createBootstrapAdminRepository(driver, "neo4j");

  await assert.rejects(
    repository.reconcile({
      serverName: "Community Forum",
      email: "admin@example.test",
      username: "admin",
    }),
    /username is linked to a different email/
  );
  assert.equal(closeCalls, 1);
});
