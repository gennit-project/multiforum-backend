import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import getSiteWideDiscussionListResolver from "./getSiteWideDiscussionList.js";

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
  selectedTags: [],
  showArchived: false,
  hasDownload: false,
  loggedInUsername: undefined as string | undefined,
  options: {
    offset: "0",
    limit: "10",
    resultsOrder: "desc",
    sort: "new",
    timeFrame: "week",
  },
};

// Search filter tests
test("getSiteWideDiscussionList passes empty search input when not provided", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(null, { ...baseArgs, searchInput: "" } as any, createMockContext(), mockInfo);

  assert.equal(driver.runCalls.length, 1);
  assert.equal(driver.runCalls[0].params.searchInput, "");
  assert.equal(driver.runCalls[0].params.titleRegex, "(?i).*.*");
  assert.equal(driver.runCalls[0].params.bodyRegex, "(?i).*.*");
});

test("getSiteWideDiscussionList passes search input with regex pattern for title and body", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, searchInput: "hello world" } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.searchInput, "hello world");
  assert.equal(driver.runCalls[0].params.titleRegex, "(?i).*hello world.*");
  assert.equal(driver.runCalls[0].params.bodyRegex, "(?i).*hello world.*");
});

// Channel filter tests
test("getSiteWideDiscussionList passes empty array when no channels selected", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, selectedChannels: [] } as any,
    createMockContext(),
    mockInfo
  );

  assert.deepEqual(driver.runCalls[0].params.selectedChannels, []);
});

test("getSiteWideDiscussionList passes selected channels to query", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  const channels = ["general", "tech", "news"];
  await resolver(
    null,
    { ...baseArgs, selectedChannels: channels } as any,
    createMockContext(),
    mockInfo
  );

  assert.deepEqual(driver.runCalls[0].params.selectedChannels, channels);
});

// Tag filter tests
test("getSiteWideDiscussionList passes empty array when no tags selected", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, selectedTags: [] } as any,
    createMockContext(),
    mockInfo
  );

  assert.deepEqual(driver.runCalls[0].params.selectedTags, []);
});

test("getSiteWideDiscussionList passes selected tags to query", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  const tags = ["javascript", "react", "vue"];
  await resolver(
    null,
    { ...baseArgs, selectedTags: tags } as any,
    createMockContext(),
    mockInfo
  );

  assert.deepEqual(driver.runCalls[0].params.selectedTags, tags);
});

// Archive filter tests
test("getSiteWideDiscussionList passes showArchived=false to exclude archived discussions", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, showArchived: false } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.showArchived, false);
});

test("getSiteWideDiscussionList passes showArchived=true to include archived discussions", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, showArchived: true } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.showArchived, true);
});

// Download filter tests
test("getSiteWideDiscussionList passes hasDownload=false to exclude downloads", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, hasDownload: false } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.hasDownload, false);
});

test("getSiteWideDiscussionList passes hasDownload=true to filter for downloads", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, hasDownload: true } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.hasDownload, true);
});

// Sort mode tests
test("getSiteWideDiscussionList sorts by new with sortOption=new", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "new" } } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.sortOption, "new");
  assert.equal(driver.runCalls[0].params.startOfTimeFrame, null);
});

test("getSiteWideDiscussionList sorts by top with sortOption=top and time frame", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "top", timeFrame: "month" } } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.sortOption, "top");
  assert.ok(driver.runCalls[0].params.startOfTimeFrame !== null);
});

test("getSiteWideDiscussionList sorts by hot with sortOption=hot as default", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "hot" } } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.sortOption, "hot");
});

test("getSiteWideDiscussionList defaults to hot sort for unknown sort option", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "invalid" } } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.sortOption, "hot");
});

// Pagination tests
test("getSiteWideDiscussionList passes offset and limit from options", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, offset: "50", limit: "25" } } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.offset, "50");
  assert.equal(driver.runCalls[0].params.limit, "25");
});

test("getSiteWideDiscussionList passes resultsOrder from options", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, resultsOrder: "asc" } } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.resultsOrder, "asc");
});

// Logged in user tests
test("getSiteWideDiscussionList passes null when no user is logged in", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, loggedInUsername: undefined } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.loggedInUsername, null);
});

test("getSiteWideDiscussionList passes username when user is logged in", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, loggedInUsername: "alice" } as any,
    createMockContext(),
    mockInfo
  );

  assert.equal(driver.runCalls[0].params.loggedInUsername, "alice");
});

// Response structure tests
test("getSiteWideDiscussionList returns discussions and aggregateCount", async () => {
  const mockDiscussion = {
    id: "d-1",
    title: "Test Discussion",
    body: "Test body content",
  };
  const driver = createMockDriver([
    { discussion: mockDiscussion, totalCount: 100 },
  ]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  const result = await resolver(null, baseArgs as any, createMockContext(), mockInfo);

  assert.ok(result.discussions);
  assert.equal(result.discussions.length, 1);
  assert.deepEqual(result.discussions[0], mockDiscussion);
  assert.equal(result.aggregateDiscussionCount, 100);
});

test("getSiteWideDiscussionList returns empty array and zero count when no results", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  const result = await resolver(null, baseArgs as any, createMockContext(), mockInfo);

  assert.deepEqual(result.discussions, []);
  assert.equal(result.aggregateDiscussionCount, 0);
});

test("getSiteWideDiscussionList returns multiple discussions", async () => {
  const mockDiscussions = [
    { discussion: { id: "d-1", title: "First" }, totalCount: 3 },
    { discussion: { id: "d-2", title: "Second" }, totalCount: 3 },
    { discussion: { id: "d-3", title: "Third" }, totalCount: 3 },
  ];
  const driver = createMockDriver(mockDiscussions);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  const result = await resolver(null, baseArgs as any, createMockContext(), mockInfo);

  assert.equal(result.discussions.length, 3);
  assert.equal(result.discussions[0].id, "d-1");
  assert.equal(result.discussions[1].id, "d-2");
  assert.equal(result.discussions[2].id, "d-3");
});

// Error handling tests
test("getSiteWideDiscussionList throws error with message when query fails", async () => {
  const driver = {
    session: () => ({
      run: async () => {
        throw new Error("Database unavailable");
      },
      close: async () => {},
    }),
  } as unknown as Driver;
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await assert.rejects(
    () => resolver(null, baseArgs as any, createMockContext(), mockInfo),
    {
      message: /Failed to fetch discussions.*Database unavailable/,
    }
  );
});

// Combined filters test
test("getSiteWideDiscussionList applies multiple filters together", async () => {
  const driver = createMockDriver([]);
  const resolver = getSiteWideDiscussionListResolver({
    Discussion: {} as any,
    driver,
  });

  await resolver(
    null,
    {
      ...baseArgs,
      searchInput: "test",
      selectedChannels: ["general", "tech"],
      selectedTags: ["javascript"],
      showArchived: true,
      hasDownload: true,
      loggedInUsername: "alice",
      options: {
        offset: "10",
        limit: "20",
        resultsOrder: "desc",
        sort: "top",
        timeFrame: "month",
      },
    } as any,
    createMockContext(),
    mockInfo
  );

  const params = driver.runCalls[0].params;
  assert.equal(params.searchInput, "test");
  assert.deepEqual(params.selectedChannels, ["general", "tech"]);
  assert.deepEqual(params.selectedTags, ["javascript"]);
  assert.equal(params.showArchived, true);
  assert.equal(params.hasDownload, true);
  assert.equal(params.loggedInUsername, "alice");
  assert.equal(params.offset, "10");
  assert.equal(params.limit, "20");
  assert.equal(params.resultsOrder, "desc");
  assert.equal(params.sortOption, "top");
  assert.ok(params.startOfTimeFrame !== null);
});
