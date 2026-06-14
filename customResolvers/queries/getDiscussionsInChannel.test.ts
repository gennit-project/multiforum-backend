import assert from "node:assert/strict";
import test from "node:test";
import getDiscussionsInChannelResolver from "./getDiscussionsInChannel.js";

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
  };
};

const createMockContext = (username: string | null = null) => ({
  req: {
    headers: {},
  },
  user: username ? { username } : null,
});

const baseArgs = {
  channelUniqueName: "test-channel",
  options: {
    offset: "0",
    limit: "10",
    sort: "new",
    timeFrame: "week",
  },
  selectedTags: [],
  searchInput: "",
  showArchived: false,
  showUnanswered: false,
  hasDownload: null,
  labelFilters: [],
};

// Search filter tests
test("getDiscussionsInChannel passes empty search input when not provided", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(null, { ...baseArgs, searchInput: "" } as any, createMockContext(), null);

  assert.equal(driver.runCalls.length, 1);
  assert.equal(driver.runCalls[0].params.searchInput, "");
  assert.equal(driver.runCalls[0].params.titleRegex, "(?i).*.*");
  assert.equal(driver.runCalls[0].params.bodyRegex, "(?i).*.*");
});

test("getDiscussionsInChannel passes search input with regex pattern for title and body", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, searchInput: "test query" } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.searchInput, "test query");
  assert.equal(driver.runCalls[0].params.titleRegex, "(?i).*test query.*");
  assert.equal(driver.runCalls[0].params.bodyRegex, "(?i).*test query.*");
});

// Tag filter tests
test("getDiscussionsInChannel passes empty array when no tags selected", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(null, { ...baseArgs, selectedTags: [] } as any, createMockContext(), null);

  assert.deepEqual(driver.runCalls[0].params.selectedTags, []);
});

test("getDiscussionsInChannel passes selected tags to query", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  const tags = ["javascript", "typescript", "nodejs"];
  await resolver(
    null,
    { ...baseArgs, selectedTags: tags } as any,
    createMockContext(),
    null
  );

  assert.deepEqual(driver.runCalls[0].params.selectedTags, tags);
});

// Archive filter tests
test("getDiscussionsInChannel passes showArchived=false to exclude archived discussions", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, showArchived: false } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.showArchived, false);
});

test("getDiscussionsInChannel passes showArchived=true to include archived discussions", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, showArchived: true } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.showArchived, true);
});

// Unanswered filter tests
test("getDiscussionsInChannel passes showUnanswered=false by default", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(null, baseArgs as any, createMockContext(), null);

  assert.equal(driver.runCalls[0].params.showUnanswered, false);
});

test("getDiscussionsInChannel passes showUnanswered=true to filter for unanswered discussions", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, showUnanswered: true } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.showUnanswered, true);
});

// Download filter tests
test("getDiscussionsInChannel passes hasDownload=null when not specified", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(null, { ...baseArgs, hasDownload: null } as any, createMockContext(), null);

  assert.equal(driver.runCalls[0].params.hasDownload, null);
});

test("getDiscussionsInChannel passes hasDownload=true to filter for downloads", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, hasDownload: true } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.hasDownload, true);
});

test("getDiscussionsInChannel passes hasDownload=false to exclude downloads", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, hasDownload: false } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.hasDownload, false);
});

// Label filters tests
test("getDiscussionsInChannel passes empty array when no label filters specified", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(null, { ...baseArgs, labelFilters: [] } as any, createMockContext(), null);

  assert.deepEqual(driver.runCalls[0].params.labelFilters, []);
});

test("getDiscussionsInChannel passes label filters to query", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  const labelFilters = [
    { groupKey: "status", values: ["open", "in-progress"] },
    { groupKey: "priority", values: ["high"] },
  ];
  await resolver(
    null,
    { ...baseArgs, labelFilters } as any,
    createMockContext(),
    null
  );

  assert.deepEqual(driver.runCalls[0].params.labelFilters, labelFilters);
});

// Sort mode tests
test("getDiscussionsInChannel sorts by new with sortOption=new", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "new" } } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.sortOption, "new");
  assert.equal(driver.runCalls[0].params.startOfTimeFrame, null);
});

test("getDiscussionsInChannel sorts by top with sortOption=top and time frame", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "top", timeFrame: "month" } } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.sortOption, "top");
  assert.ok(driver.runCalls[0].params.startOfTimeFrame !== null);
});

test("getDiscussionsInChannel sorts by hot with sortOption=hot as default", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "hot" } } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.sortOption, "hot");
});

test("getDiscussionsInChannel defaults to hot sort for unknown sort option", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "unknown" } } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.sortOption, "hot");
});

// Pagination tests
test("getDiscussionsInChannel passes offset and limit from options", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, offset: "20", limit: "50" } } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.offset, 20);
  assert.equal(driver.runCalls[0].params.limit, 50);
});

// Channel name tests
test("getDiscussionsInChannel passes channel unique name to query", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await resolver(
    null,
    { ...baseArgs, channelUniqueName: "my-channel" } as any,
    createMockContext(),
    null
  );

  assert.equal(driver.runCalls[0].params.channelUniqueName, "my-channel");
});

// Response structure tests
test("getDiscussionsInChannel returns discussionChannels and aggregateCount", async () => {
  const mockDiscussionChannel = {
    id: "dc-1",
    discussionId: "d-1",
    channelUniqueName: "test-channel",
  };
  const driver = createMockDriver([
    { DiscussionChannel: mockDiscussionChannel, totalCount: 42 },
  ]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  const result = await resolver(null, baseArgs as any, createMockContext(), null);

  assert.ok(result.discussionChannels);
  assert.equal(result.discussionChannels.length, 1);
  assert.deepEqual(result.discussionChannels[0], mockDiscussionChannel);
  assert.equal(result.aggregateDiscussionChannelsCount, 42);
});

test("getDiscussionsInChannel returns empty array and zero count when no results", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  const result = await resolver(null, baseArgs as any, createMockContext(), null);

  assert.deepEqual(result.discussionChannels, []);
  assert.equal(result.aggregateDiscussionChannelsCount, 0);
});

// Error handling tests
test("getDiscussionsInChannel throws error with message when query fails", async () => {
  const driver = {
    session: () => ({
      run: async () => {
        throw new Error("Database connection failed");
      },
      close: async () => {},
    }),
  };
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {} as any,
    driver,
  });

  await assert.rejects(
    () => resolver(null, baseArgs as any, createMockContext(), null),
    {
      message: /Failed to fetch discussionChannels in channel.*Database connection failed/,
    }
  );
});
