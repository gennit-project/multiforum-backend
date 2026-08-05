// Unit tests for the getSortedChannels resolver with a mocked Neo4j driver.
// These assert the resolver's Cypher-shaping and parameter logic without a
// live database (integration behavior is covered separately in
// tests/integration). They focus on the full-text search branching, result
// mapping, error handling, and parameter defaults.

import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import getSortedChannelsResolver from "./getSortedChannels.js";
import { CHANNEL_FULLTEXT_INDEX } from "../../services/channelFulltext.js";

type SessionRunCall = {
  query: string;
  params: Record<string, unknown>;
};

type MockDriverOptions = {
  records?: Array<Record<string, unknown>>;
  throwOnRun?: boolean;
};

const createMockDriver = (options: MockDriverOptions = {}) => {
  const { records = [], throwOnRun = false } = options;
  const runCalls: SessionRunCall[] = [];
  const state = { closeCount: 0 };

  const driver = {
    runCalls,
    state,
    session: () => ({
      run: async (query: string, params: Record<string, unknown>) => {
        runCalls.push({ query, params });
        if (throwOnRun) {
          throw new Error("boom");
        }
        return {
          records: records.map((record) => ({
            get: (key: string) => record[key],
          })),
        };
      },
      close: async () => {
        state.closeCount += 1;
      },
    }),
  } as unknown as Driver & {
    runCalls: SessionRunCall[];
    state: { closeCount: number };
  };

  return driver;
};

// Minimal unauthenticated context: setUserDataOnContext returns a null user
// without touching the database when there is no authorization header.
const anonContext = () =>
  ({ req: { headers: {} } }) as unknown as GraphQLContext;

const call = (
  driver: ReturnType<typeof createMockDriver>,
  args: Record<string, unknown>,
  context?: GraphQLContext
) =>
  getSortedChannelsResolver({ driver })(
    null,
    { countDownloads: null, ...args },
    context
  );

// --- search-term branching ---

test("empty search input uses the unfiltered match path, not the full-text index", async () => {
  const driver = createMockDriver();
  await call(driver, { searchInput: "" });

  const { query, params } = driver.runCalls[0];
  assert.match(query, /MATCH \(c:Channel\)/);
  assert.match(query, /0\.0 AS score/);
  assert.doesNotMatch(query, /db\.index\.fulltext\.queryNodes/);
  assert.equal(params.fulltextQuery, "");
  assert.equal(params.fulltextIndex, CHANNEL_FULLTEXT_INDEX);
});

test("omitted search input defaults to the unfiltered match path", async () => {
  const driver = createMockDriver();
  await call(driver, {});

  const { query, params } = driver.runCalls[0];
  assert.doesNotMatch(query, /db\.index\.fulltext\.queryNodes/);
  assert.equal(params.fulltextQuery, "");
});

test("non-empty search input drives the query from the full-text index", async () => {
  const driver = createMockDriver();
  await call(driver, { searchInput: "dog" });

  const { query, params } = driver.runCalls[0];
  assert.match(
    query,
    /CALL db\.index\.fulltext\.queryNodes\(\$fulltextIndex, \$fulltextQuery\) YIELD node AS c, score/
  );
  assert.doesNotMatch(query, /0\.0 AS score/);
  assert.equal(params.fulltextIndex, CHANNEL_FULLTEXT_INDEX);
  assert.equal(params.fulltextQuery, "dog*");
});

test("multi-word search input is AND-ed with per-term prefix wildcards", async () => {
  const driver = createMockDriver();
  await call(driver, { searchInput: "big dog" });

  assert.equal(driver.runCalls[0].params.fulltextQuery, "big* AND dog*");
});

test("search input with Lucene metacharacters is escaped before wildcarding", async () => {
  const driver = createMockDriver();
  await call(driver, { searchInput: "a-b" });

  assert.equal(driver.runCalls[0].params.fulltextQuery, "a\\-b*");
});

test("whitespace-only search input falls back to the unfiltered path", async () => {
  const driver = createMockDriver();
  await call(driver, { searchInput: "   " });

  assert.doesNotMatch(driver.runCalls[0].query, /db\.index\.fulltext\.queryNodes/);
  assert.equal(driver.runCalls[0].params.fulltextQuery, "");
});

// --- result mapping ---

test("maps records to channels and reads the aggregate from the first record", async () => {
  const driver = createMockDriver({
    records: [
      { channel: { uniqueName: "cats" }, aggregateChannelCount: 2 },
      { channel: { uniqueName: "dogs" }, aggregateChannelCount: 2 },
    ],
  });

  const result = await call(driver, { searchInput: "" });

  assert.deepEqual(result.channels, [
    { uniqueName: "cats" },
    { uniqueName: "dogs" },
  ]);
  assert.equal(result.aggregateChannelCount, 2);
});

test("returns an aggregate count of 0 when there are no matching records", async () => {
  const driver = createMockDriver({ records: [] });

  const result = await call(driver, { searchInput: "nope" });

  assert.deepEqual(result.channels, []);
  assert.equal(result.aggregateChannelCount, 0);
});

// --- parameters ---

test("applies default limit and offset when not provided", async () => {
  const driver = createMockDriver();
  await call(driver, {});

  assert.equal(driver.runCalls[0].params.limit, "25");
  assert.equal(driver.runCalls[0].params.offset, "0");
});

test("passes through provided pagination, tags, and countDownloads", async () => {
  const driver = createMockDriver();
  await call(driver, {
    limit: "5",
    offset: "10",
    tags: ["pets", "vehicles"],
    countDownloads: true,
  });

  const { params } = driver.runCalls[0];
  assert.equal(params.limit, "5");
  assert.equal(params.offset, "10");
  assert.deepEqual(params.tags, ["pets", "vehicles"]);
  assert.equal(params.countDownloads, true);
});

test("defaults tags to an empty array when omitted", async () => {
  const driver = createMockDriver();
  await call(driver, {});

  assert.deepEqual(driver.runCalls[0].params.tags, []);
});

// --- logged-in user ---

test("passes a null username when there is no context", async () => {
  const driver = createMockDriver();
  await call(driver, {});

  assert.equal(driver.runCalls[0].params.loggedInUsername, null);
});

test("passes a null username for an unauthenticated context", async () => {
  const driver = createMockDriver();
  await call(driver, {}, anonContext());

  assert.equal(driver.runCalls[0].params.loggedInUsername, null);
});

test("passes the resolved username for an authenticated context", async () => {
  const driver = createMockDriver();
  const context = {
    req: { headers: {} },
    user: {
      username: "alice",
      email: null,
      email_verified: true,
      data: null,
    },
  } as unknown as GraphQLContext;

  await call(driver, {}, context);

  assert.equal(driver.runCalls[0].params.loggedInUsername, "alice");
});

// --- error handling ---

test("wraps database errors and still closes the session", async () => {
  const driver = createMockDriver({ throwOnRun: true });

  await assert.rejects(
    () => call(driver, { searchInput: "" }),
    /Failed to fetch sorted channels/
  );
  assert.equal(driver.state.closeCount, 1, "session is closed in finally");
});
