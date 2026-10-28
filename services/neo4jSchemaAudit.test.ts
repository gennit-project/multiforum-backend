import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  evaluateSchemaAudit,
  getRequiredConstraintNames,
  requiredConstraintNames,
  requiredEnterpriseConstraintNames,
  requiredOnlineIndexNames,
  runNeo4jSchemaAudit,
  type IntegrityCounts,
} from "./neo4jSchemaAudit.js";

test("schema audit requires the single-field identity constraints and their indexes", () => {
  // v7 removed `@unique`, so these single-field uniqueness constraints are no
  // longer library-managed; they are created explicitly at startup and named
  // `<label>_<property>_unique` (or a pinned explicit name). The audit must
  // still require every one of them.
  assert.equal(requiredConstraintNames.includes("user_username_unique"), true);
  assert.equal(requiredConstraintNames.includes("discussion_id_unique"), true);
  assert.equal(requiredConstraintNames.includes("plugin_pipeline_run_pipeline_id"), true);
  assert.equal(requiredConstraintNames.includes("PluginPipelineRun_pipelineId"), false);
  assert.equal(requiredConstraintNames.includes("discussion_channel_unique"), true);
  assert.equal(requiredConstraintNames.includes("channelrole_id_unique"), true);
  assert.equal(requiredConstraintNames.includes("ChannelRole_name"), false);
  assert.equal(
    requiredConstraintNames.every((name) => requiredOnlineIndexNames.includes(name)),
    true
  );
});

const cleanIntegrity: IntegrityCounts = {
  discussionChannelsWithInvalidEndpoints: 0,
  discussionChannelsWithMismatchedIdentity: 0,
  eventChannelsWithInvalidEndpoints: 0,
  eventChannelsWithMismatchedIdentity: 0,
  commentsWithMultipleParents: 0,
  commentsInReplyCycles: 0,
  commentsOverMaxReplyDepth: 0,
  invalidChannelIssueCounters: 0,
  invalidServerIssueCounters: 0,
  discussionFlairsWithInvalidOwners: 0,
  discussionFlairsWithStoredChannelUniqueName: 0,
  wikiPagesWithInvalidOwners: 0,
  wikiPagesWithMismatchedOwners: 0,
  invalidWikiPageRoutes: 0,
  channelRolesWithInvalidOwners: 0,
  channelRolesWithMismatchedOwners: 0,
  invalidChannelRoleIdentities: 0,
  issuesWithInvalidTargetRelationships: 0,
  issuesMissingLiveTargetRelationships: 0,
};

test("schema audit passes a complete and consistent snapshot", () => {
  const report = evaluateSchemaAudit({
    edition: "community",
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
    edition: "community",
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

test("Enterprise audit additionally requires critical property constraints", () => {
  const report = evaluateSchemaAudit({
    edition: "enterprise",
    constraints: [...requiredConstraintNames],
    onlineIndexes: [...requiredOnlineIndexNames],
    integrity: cleanIntegrity,
  });
  assert.equal(report.ok, false);
  assert.equal(
    report.problems.includes(
      `Missing constraint: ${requiredEnterpriseConstraintNames[0]}`
    ),
    true
  );
  assert.deepEqual(
    getRequiredConstraintNames("enterprise"),
    [...requiredConstraintNames, ...requiredEnterpriseConstraintNames]
  );
});

test("runNeo4jSchemaAudit reads the schema and integrity checks, then closes", async () => {
  const queries: string[] = [];
  let closed = false;
  const driver = {
    session: () => ({
      run: async (query: string) => {
        queries.push(query);
        if (query.includes("dbms.components")) {
          return { records: [{ get: () => "community" }] };
        }
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
  assert.equal(queries.length, 22);
  assert.equal(closed, true);
});
