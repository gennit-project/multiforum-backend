import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  auditCriticalProperties,
  CriticalPropertyDataError,
  criticalPropertyConstraintNames,
  criticalPropertyDefinitions,
  ensureCriticalPropertyConstraints,
  getCriticalPropertyConstraintStatements,
  migrateCriticalPropertyConstraints,
} from "./criticalPropertyConstraints.js";

type FakeState = {
  missingImageCreatedAt: boolean;
  wrongUserNameType: boolean;
  constraints: Set<string>;
  closedSessions: number;
  repairCalls: number;
  hideFirstConstraintOnShow: boolean;
};

const record = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
});

const fakeDriver = (overrides: Partial<FakeState> = {}) => {
  const state: FakeState = {
    missingImageCreatedAt: false,
    wrongUserNameType: false,
    constraints: new Set<string>(),
    closedSessions: 0,
    repairCalls: 0,
    hideFirstConstraintOnShow: false,
    ...overrides,
  };

  const auditRun = async (query: string) => {
    const missing = query.includes("MATCH (node:Image)") &&
      query.includes("node.createdAt") && state.missingImageCreatedAt
      ? 1
      : 0;
    const wrongType = query.includes("MATCH (node:User)") &&
      query.includes("node.username") && state.wrongUserNameType
      ? 1
      : 0;
    return {
      records: [record({
        total: neo4j.int(missing || wrongType ? 1 : 0),
        missing: neo4j.int(missing),
        wrongType: neo4j.int(wrongType),
        sampleElementIds: missing || wrongType ? ["4:test:0"] : [],
      })],
    };
  };

  const driver = {
    session: () => ({
      executeRead: async (callback: (transaction: { run: typeof auditRun }) => unknown) =>
        callback({ run: auditRun }),
      executeWrite: async (
        callback: (transaction: { run: (query: string) => Promise<unknown> }) => unknown
      ) => callback({
        run: async () => {
          state.repairCalls += 1;
          const repaired = state.missingImageCreatedAt ? 1 : 0;
          state.missingImageCreatedAt = false;
          return { records: [record({ repaired: neo4j.int(repaired) })] };
        },
      }),
      run: async (query: string, parameters?: { names?: string[] }) => {
        const created = query.match(/CREATE CONSTRAINT ([a-z0-9_]+)/)?.[1];
        if (created) state.constraints.add(created);
        if (query.includes("SHOW CONSTRAINTS")) {
          return {
            records: (parameters?.names ?? [])
              .filter((name) => state.constraints.has(name))
              .filter(
                (name) =>
                  !state.hideFirstConstraintOnShow ||
                  name !== criticalPropertyConstraintNames[0]
              )
              .map((name) => record({ name })),
          };
        }
        return { records: [] };
      },
      close: async () => {
        state.closedSessions += 1;
      },
    }),
  } as unknown as Driver;
  return { driver, state };
};

test("defines paired, idempotent existence and type constraints", () => {
  const statements = getCriticalPropertyConstraintStatements();
  assert.equal(statements.length, criticalPropertyDefinitions.length * 2);
  assert.equal(criticalPropertyConstraintNames.length, statements.length);
  assert.equal(new Set(criticalPropertyConstraintNames).size, statements.length);
  assert.equal(statements.every((item) => item.startsWith("CYPHER 25")), true);
  assert.equal(statements.every((item) => item.includes("IF NOT EXISTS")), true);
  assert.equal(statements.some((item) => item.includes("IS NOT NULL")), true);
  assert.equal(statements.some((item) => item.includes("IS :: ZONED DATETIME")), true);
});

test("audit separates the known image repair from blocking type violations", async () => {
  const { driver, state } = fakeDriver({
    missingImageCreatedAt: true,
    wrongUserNameType: true,
  });
  const audit = await auditCriticalProperties(driver);
  assert.deepEqual(
    audit.repairableViolations.map(({ label, property }) => [label, property]),
    [["Image", "createdAt"]]
  );
  assert.deepEqual(
    audit.blockingViolations.map(({ label, property }) => [label, property]),
    [["User", "username"]]
  );
  assert.equal(state.closedSessions, 1);
});

test("Community skips Enterprise-only property constraints", async () => {
  const { driver, state } = fakeDriver();
  const result = await ensureCriticalPropertyConstraints(driver, "community");
  assert.deepEqual(result, { skipped: true, constraints: [] });
  assert.equal(state.closedSessions, 0);
});

test("Enterprise refuses DDL while critical data is invalid", async () => {
  const { driver, state } = fakeDriver({ wrongUserNameType: true });
  await assert.rejects(
    () => ensureCriticalPropertyConstraints(driver, "enterprise"),
    (error: unknown) =>
      error instanceof CriticalPropertyDataError &&
      error.audit.blockingViolations.length === 1
  );
  assert.equal(state.constraints.size, 0);
  assert.equal(state.closedSessions, 1);
});

test("migration repairs the documented legacy timestamp then verifies every constraint", async () => {
  const { driver, state } = fakeDriver({ missingImageCreatedAt: true });
  const result = await migrateCriticalPropertyConstraints(driver, "enterprise");
  assert.equal(result.repairedLegacyImageTimestamps, 1);
  assert.equal(result.after.violations.length, 0);
  assert.equal(result.provision.skipped, false);
  assert.equal(state.repairCalls, 1);
  assert.deepEqual(
    [...state.constraints].sort(),
    [...criticalPropertyConstraintNames].sort()
  );
  assert.equal(state.closedSessions, 5);
});

test("provisioning fails if Neo4j does not report every expected constraint", async () => {
  const { driver } = fakeDriver({ hideFirstConstraintOnShow: true });
  await assert.rejects(
    ensureCriticalPropertyConstraints(driver, "enterprise"),
    /Critical property constraints were not created/
  );
});

test("migration is a no-op for clean data before idempotent provisioning", async () => {
  const { driver, state } = fakeDriver();
  const result = await migrateCriticalPropertyConstraints(driver, "enterprise");
  assert.equal(result.repairedLegacyImageTimestamps, 0);
  assert.equal(state.repairCalls, 0);
  assert.equal(state.closedSessions, 4);
});
