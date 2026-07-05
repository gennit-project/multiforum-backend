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

// Pre-seeds context.user so setUserDataOnContext short-circuits (it returns the
// existing user when a username is already present) instead of parsing a JWT.
const createAuthedContext = (
  username: string,
  modProfileName: string | null = null
) =>
  ({
    req: {
      headers: {},
    },
    user: {
      username,
      email: null,
      email_verified: true,
      data: modProfileName
        ? { ModerationProfile: { displayName: modProfileName } }
        : null,
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

test("getSiteWideIssueList defaults the involvement filters to false", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideIssueListResolver({ driver });

  await resolver(null, baseArgs, createMockContext(), mockInfo);

  assert.deepEqual(
    {
      filterCreatedByMe: driver.runCalls[0].params.filterCreatedByMe,
      filterIAmOP: driver.runCalls[0].params.filterIAmOP,
      filterIReported: driver.runCalls[0].params.filterIReported,
    },
    { filterCreatedByMe: false, filterIAmOP: false, filterIReported: false }
  );
});

test("getSiteWideIssueList forwards the caller identity to the query", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideIssueListResolver({ driver });

  await resolver(
    null,
    { ...baseArgs, filterCreatedByMe: true },
    createAuthedContext("alice", "aliceMod"),
    mockInfo
  );

  assert.deepEqual(
    {
      loggedInUsername: driver.runCalls[0].params.loggedInUsername,
      loggedInModProfileName: driver.runCalls[0].params.loggedInModProfileName,
      filterCreatedByMe: driver.runCalls[0].params.filterCreatedByMe,
    },
    {
      loggedInUsername: "alice",
      loggedInModProfileName: "aliceMod",
      filterCreatedByMe: true,
    }
  );
});

test("getSiteWideIssueList enables filterIAmOP for an authed caller", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideIssueListResolver({ driver });

  await resolver(
    null,
    { ...baseArgs, filterIAmOP: true },
    createAuthedContext("alice"),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.filterIAmOP, true);
});

test("getSiteWideIssueList enables filterIReported for an authed caller", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideIssueListResolver({ driver });

  await resolver(
    null,
    { ...baseArgs, filterIReported: true },
    createAuthedContext("alice"),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.filterIReported, true);
});

test("getSiteWideIssueList returns empty without running the query when an involvement filter is requested unauthenticated", async () => {
  const driver = createMockDriver([
    { issue: { id: "i1" }, totalCount: 1 },
  ]);
  const resolver = getSiteWideIssueListResolver({ driver });

  const result = await resolver(
    null,
    { ...baseArgs, filterCreatedByMe: true },
    createMockContext(),
    mockInfo
  );

  assert.deepEqual(
    { runCalls: driver.runCalls.length, result },
    { runCalls: 0, result: { aggregateIssueCount: 0, issues: [] } }
  );
});

test("getSiteWideIssueList query filters by issue author for filterCreatedByMe", () => {
  assert.match(
    getSiteWideIssuesQuery,
    /\$filterCreatedByMe = false OR issue\.authorName = \$loggedInUsername OR EXISTS \{ \(issue\)<-\[:AUTHORED_ISSUE\]-\(author\)/
  );
});

test("getSiteWideIssueList query filters by reported-content author for filterIAmOP", () => {
  assert.match(
    getSiteWideIssuesQuery,
    /\$filterIAmOP = false OR issue\.relatedUsername = \$loggedInUsername OR issue\.relatedModProfileName = \$loggedInModProfileName/
  );
});

test("getSiteWideIssueList query filters by report author for filterIReported", () => {
  assert.match(
    getSiteWideIssuesQuery,
    /\$filterIReported = false OR EXISTS \{ \(issue\)-\[:ACTIVITY_ON_ISSUE\]->\(:ModerationAction \{actionType: "report"\}\)<-\[:PERFORMED_MODERATION_ACTION\]-\(reporter\)/
  );
});

test("getSiteWideIssueList query uses bound pagination params", () => {
  assert.match(getSiteWideIssuesQuery, /SKIP \$offset/);
  assert.match(getSiteWideIssuesQuery, /LIMIT \$limit/);
});

test("getSiteWideIssueList query stringifies datetime fields", () => {
  assert.match(getSiteWideIssuesQuery, /createdAt: toString\(issue\.createdAt\)/);
  assert.match(getSiteWideIssuesQuery, /updatedAt: toString\(issue\.updatedAt\)/);
});
