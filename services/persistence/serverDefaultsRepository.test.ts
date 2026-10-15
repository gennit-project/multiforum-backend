import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import {
  BACKFILL_ADMINS_QUERY,
  DEFAULT_ROLE_RELATIONSHIPS,
  ENSURE_SERVER_CONFIG_QUERY,
  ROLE_WIRING_QUERIES,
  UPSERT_MOD_SERVER_ROLES_QUERY,
  UPSERT_SERVER_ROLES_QUERY,
  createServerDefaultsRepository,
  type ServerDefaultsReconcileInput,
} from "./serverDefaultsRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

const input: ServerDefaultsReconcileInput = {
  serverName: "Community Forum",
  serverRoles: [
    { name: "Standard", canCreateComment: true },
    { name: "Admin", canCreateComment: true },
  ],
  modServerRoles: [{ name: "Moderator", canHideComment: true }],
  wiring: [
    { relationship: "DefaultServerRole", roleName: "Standard" },
    { relationship: "DefaultAdminRole", roleName: "Admin" },
    { relationship: "DefaultModRole", roleName: "Moderator" },
  ],
};

test("reconciles defaults in one managed transaction", async () => {
  const sessionConfigs: unknown[] = [];
  const runCalls: Array<{ query: string; parameters: unknown }> = [];
  let executeWriteCalls = 0;
  let closeCalls = 0;
  const responses = [
    { records: [] },
    { records: [] },
    { records: [record({ created: true })] },
    { records: [record({ changed: true })] },
    { records: [record({ changed: false })] },
    { records: [record({ changed: true })] },
    { records: [record({ usernames: ["alice", null, "bob"] })] },
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

  const result = await createServerDefaultsRepository(
    driver,
    "defaults-db"
  ).reconcile(input);

  assert.deepEqual(result, {
    serverRolesUpserted: 2,
    modServerRolesUpserted: 1,
    serverConfigCreated: true,
    rolesWired: ["DefaultServerRole", "DefaultModRole"],
    adminsBackfilledToSuperAdmins: ["alice", "bob"],
  });
  assert.deepEqual(sessionConfigs, [{ database: "defaults-db" }]);
  assert.equal(executeWriteCalls, 1);
  assert.equal(closeCalls, 1);
  assert.deepEqual(
    runCalls.map(({ query }) => query),
    [
      UPSERT_SERVER_ROLES_QUERY,
      UPSERT_MOD_SERVER_ROLES_QUERY,
      ENSURE_SERVER_CONFIG_QUERY,
      ROLE_WIRING_QUERIES.DefaultServerRole,
      ROLE_WIRING_QUERIES.DefaultAdminRole,
      ROLE_WIRING_QUERIES.DefaultModRole,
      BACKFILL_ADMINS_QUERY,
    ]
  );
  assert.deepEqual(runCalls[0]?.parameters, { roles: input.serverRoles });
  assert.deepEqual(runCalls[2]?.parameters, {
    serverName: "Community Forum",
  });
  assert.deepEqual(runCalls[3]?.parameters, {
    serverName: "Community Forum",
    roleName: "Standard",
  });
});

test("uses label-specific queries for the shared suspended relationship type", () => {
  assert.match(
    ROLE_WIRING_QUERIES.DefaultSuspendedRole,
    /current:ServerRole/
  );
  assert.match(
    ROLE_WIRING_QUERIES.DefaultSuspendedModRole,
    /current:ModServerRole/
  );
  assert.equal(
    DEFAULT_ROLE_RELATIONSHIPS.DefaultSuspendedRole.relationshipType,
    DEFAULT_ROLE_RELATIONSHIPS.DefaultSuspendedModRole.relationshipType
  );
});

test("closes the session when reconciliation fails", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async executeWrite(work: (tx: unknown) => Promise<unknown>) {
          return work({
            async run() {
              throw new Error("database rejected defaults");
            },
          });
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  await assert.rejects(
    createServerDefaultsRepository(driver).reconcile(input),
    /database rejected defaults/
  );
  assert.equal(closeCalls, 1);
});
