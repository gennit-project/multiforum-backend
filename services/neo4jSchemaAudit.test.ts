import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  evaluateSchemaAudit,
  requiredConstraintNames,
  requiredOnlineIndexNames,
  runNeo4jSchemaAudit,
  type IntegrityCounts,
} from "./neo4jSchemaAudit.js";

const cleanIntegrity: IntegrityCounts = {
  discussionChannelsWithInvalidEndpoints: 0,
  discussionChannelsWithMismatchedIdentity: 0,
  eventChannelsWithInvalidEndpoints: 0,
  eventChannelsWithMismatchedIdentity: 0,
  commentsWithMultipleParents: 0,
  commentsInReplyCycles: 0,
  invalidChannelIssueCounters: 0,
  invalidServerIssueCounters: 0,
};

test("schema audit passes a complete and consistent snapshot", () => {
  const report = evaluateSchemaAudit({
    constraints: [...requiredConstraintNames],
    onlineIndexes: [...requiredOnlineIndexNames],
    integrity: cleanIntegrity,
  });
  assert.deepEqual({ ok: report.ok, problems: report.problems }, {
    ok: true,
    problems: [],
  });
});

test("schema audit reports missing schema and integrity failures", () => {
  const report = evaluateSchemaAudit({
    constraints: [],
    onlineIndexes: [],
    integrity: {
      ...cleanIntegrity,
      discussionChannelsWithInvalidEndpoints: 3,
    },
  });
  assert.deepEqual({
    ok: report.ok,
    hasConstraintProblem: report.problems.some((item) => item.includes("constraint")),
    hasIndexProblem: report.problems.some((item) => item.includes("Index")),
    hasIntegrityProblem: report.problems.includes(
      "discussionChannelsWithInvalidEndpoints: 3"
    ),
  }, {
    ok: false,
    hasConstraintProblem: true,
    hasIndexProblem: true,
    hasIntegrityProblem: true,
  });
});

test("runNeo4jSchemaAudit reads the schema and integrity checks, then closes", async () => {
  const queries: string[] = [];
  let closed = false;
  const driver = {
    session: () => ({
      run: async (query: string) => {
        queries.push(query);
        if (query.includes("SHOW CONSTRAINTS")) {
          return {
            records: requiredConstraintNames.map((name) => ({
              get: () => name,
            })),
          };
        }
        if (query.includes("SHOW INDEXES")) {
          return {
            records: requiredOnlineIndexNames.map((name) => ({
              get: () => name,
            })),
          };
        }
        return { records: [{ get: () => neo4j.int(0) }] };
      },
      close: async () => {
        closed = true;
      },
    }),
  } as unknown as Driver;

  const report = await runNeo4jSchemaAudit(driver);

  assert.equal(report.ok, true);
  assert.equal(queries.length, 10);
  assert.equal(closed, true);
});
