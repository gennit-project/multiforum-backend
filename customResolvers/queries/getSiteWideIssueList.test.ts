import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLResolveInfo } from "graphql";
import neo4j, { type Driver, type Integer } from "neo4j-driver";
import { getSiteWideIssuesQuery } from "../cypher/cypherQueries.js";
import type { GraphQLContext } from "../../types/context.js";
import getSiteWideIssueListResolver from "./getSiteWideIssueList.js";

type SessionRunCall = {
  query: string;
  params: Record<string, unknown>;
};

const createMockDriver = (mockRecords: Array<Record<string, unknown>> = []) => {
  const runCalls: SessionRunCall[] = [];

  return {
    runCalls,
    session: () => ({
      run: async (query: string, params: Record<string, unknown>) => {
        runCalls.push({ query, params });
        return {
          records: mockRecords.map((record) => ({
            get: (key: string) => record[key],
          })),
        };
      },
      close: async () => {},
    }),
  } as unknown as Driver & { runCalls: SessionRunCall[] };
};

const createMockContext = () =>
  ({
    req: {
      headers: {},
    },
  }) as unknown as GraphQLContext;

const mockInfo = null as unknown as GraphQLResolveInfo;

const baseArgs = {
  searchInput: "",
  selectedChannels: [],
  startDate: null,
  endDate: null,
  showOnlyServerRuleViolations: true,
  isOpen: true,
  options: {
    offset: 0,
    limit: null,
    sort: "newest",
  },
};

test("getSiteWideIssueList passes the default params to the query", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideIssueListResolver({ driver });

  await resolver(null, baseArgs, createMockContext(), mockInfo);

  assert.equal(driver.runCalls.length, 1);
  assert.equal(driver.runCalls[0].params.searchInput, "");
  assert.equal(driver.runCalls[0].params.sort, "newest");
  assert.equal(driver.runCalls[0].params.isOpen, true);
  assert.deepEqual(driver.runCalls[0].params.selectedChannels, []);
  assert.equal(neo4j.isInt(driver.runCalls[0].params.offset), true);
  assert.equal((driver.runCalls[0].params.offset as Integer).toNumber(), 0);
  assert.equal(neo4j.isInt(driver.runCalls[0].params.limit), true);
  assert.equal(
    (driver.runCalls[0].params.limit as Integer).toNumber(),
    1_000_000_000
  );
});

test("getSiteWideIssueList normalizes date filters to full-day UTC bounds", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideIssueListResolver({ driver });

  await resolver(
    null,
    {
      ...baseArgs,
      startDate: "2026-05-01",
      endDate: "2026-07-01",
    },
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.startDate, "2026-05-01T00:00:00.000Z");
  assert.equal(driver.runCalls[0].params.endDate, "2026-07-01T23:59:59.999Z");
});

test("getSiteWideIssueList passes selected channels and rule-violation filter", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideIssueListResolver({ driver });

  await resolver(
    null,
    {
      ...baseArgs,
      selectedChannels: ["cats", "dogs"],
      showOnlyServerRuleViolations: false,
    },
    createMockContext(),
    mockInfo
  );

  assert.deepEqual(driver.runCalls[0].params.selectedChannels, ["cats", "dogs"]);
  assert.equal(driver.runCalls[0].params.showOnlyServerRuleViolations, false);
});

test("getSiteWideIssueList passes sort options through", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideIssueListResolver({ driver });

  await resolver(
    null,
    {
      ...baseArgs,
      options: {
        offset: 3,
        limit: 25,
        sort: "mostReports",
      },
    },
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.sort, "mostReports");
  assert.equal((driver.runCalls[0].params.offset as Integer).toNumber(), 3);
  assert.equal((driver.runCalls[0].params.limit as Integer).toNumber(), 25);
});

test("getSiteWideIssueList falls back to newest for unknown sort", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideIssueListResolver({ driver });

  await resolver(
    null,
    {
      ...baseArgs,
      options: {
        ...baseArgs.options,
        sort: "weird",
      },
    } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.sort, "newest");
});

test("getSiteWideIssueList returns issues and aggregate count", async () => {
  const driver = createMockDriver([
    {
      issue: { id: "i1", title: "First", reportCount: 3 },
      totalCount: 2,
    },
    {
      issue: { id: "i2", title: "Second", reportCount: 1 },
      totalCount: 2,
    },
  ]);
  const resolver = getSiteWideIssueListResolver({ driver });

  const result = await resolver(null, baseArgs, createMockContext(), mockInfo);

  assert.equal(result.aggregateIssueCount, 2);
  assert.deepEqual(result.issues, [
    { id: "i1", title: "First", reportCount: 3 },
    { id: "i2", title: "Second", reportCount: 1 },
  ]);
});

test("getSiteWideIssueList query uses bound pagination params", () => {
  assert.match(getSiteWideIssuesQuery, /SKIP \$offset/);
  assert.match(getSiteWideIssuesQuery, /LIMIT \$limit/);
});

test("getSiteWideIssueList query stringifies datetime fields", () => {
  assert.match(getSiteWideIssuesQuery, /createdAt: toString\(issue\.createdAt\)/);
  assert.match(getSiteWideIssuesQuery, /updatedAt: toString\(issue\.updatedAt\)/);
});
