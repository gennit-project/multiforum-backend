import assert from "node:assert/strict";
import test from "node:test";
import getDiscussionsInChannelResolver from "./getDiscussionsInChannel.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type SessionRunCall = {
  query: string;
  params: Record<string, unknown>;
};

const createMockDriver = (mockRecords: Array<Record<string, unknown>> = []) => {
  const runCalls: SessionRunCall[] = [];
  const toRecords = (records: Array<Record<string, unknown>>) =>
    records.map((record) => ({
      get: (key: string) => record[key],
    }));
  const discussionChannelIds = mockRecords.flatMap((record) => {
    const discussionChannel = record.DiscussionChannel;
    if (
      typeof discussionChannel === "object" &&
      discussionChannel !== null &&
      "id" in discussionChannel &&
      typeof discussionChannel.id === "string"
    ) {
      return [discussionChannel.id];
    }
    return [];
  });

  return {
    runCalls,
    session: () => ({
      executeWrite: async (
        work: (transaction: {
          run: (query: string, params: Record<string, unknown>) => Promise<{
            records: Array<{ get: (key: string) => unknown }>;
          }>;
        }) => Promise<unknown>
      ) => {
        let transactionRunIndex = 0;
        return work({
          run: async (query: string, params: Record<string, unknown>) => {
            runCalls.push({ query, params });
            transactionRunIndex += 1;
            if (transactionRunIndex === 1) {
              return {
                records: toRecords([
                  {
                    totalCount: mockRecords[0]?.totalCount ?? 0,
                    discussionChannelIds,
                  },
                ]),
              };
            }
            return { records: toRecords(mockRecords) };
          },
        });
      },
      close: async () => {},
    }),
  };
};

const createMockContext = (username: string | null = null) =>
  ({
    req: {
      headers: {},
    },
    user: username ? { username } : null,
  } as unknown as GraphQLContext);

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
test("getDiscussionsInChannel omits inactive search filtering", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(null, { ...baseArgs, searchInput: "" } as any, createMockContext(), null as unknown as GraphQLResolveInfo);

  assert.equal(driver.runCalls.length, 1);
  assert.equal(driver.runCalls[0].params.titleRegex, undefined);
  assert.equal(driver.runCalls[0].params.bodyRegex, undefined);
  assert.doesNotMatch(driver.runCalls[0].query, /\$titleRegex|\$bodyRegex/);
});

test("getDiscussionsInChannel passes search input with regex pattern for title and body", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, searchInput: "test query" } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(driver.runCalls[0].params.titleRegex, "(?i).*test query.*");
  assert.equal(driver.runCalls[0].params.bodyRegex, "(?i).*test query.*");
  assert.match(driver.runCalls[0].query, /discussion\.title =~ \$titleRegex/);
});

// Tag filter tests
test("getDiscussionsInChannel omits inactive tag filtering", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(null, { ...baseArgs, selectedTags: [] } as any, createMockContext(), null as unknown as GraphQLResolveInfo);

  assert.equal(driver.runCalls[0].params.selectedTags, undefined);
  assert.doesNotMatch(driver.runCalls[0].query, /\$selectedTags/);
});

test("getDiscussionsInChannel passes selected tags to query", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  const tags = ["javascript", "typescript", "nodejs"];
  await resolver(
    null,
    { ...baseArgs, selectedTags: tags } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.deepEqual(driver.runCalls[0].params.selectedTags, tags);
  assert.match(driver.runCalls[0].query, /tag\.text IN \$selectedTags/);
});

// Archive filter tests
test("getDiscussionsInChannel excludes archived discussions by default", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, showArchived: false } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.match(driver.runCalls[0].query, /coalesce\(dc\.archived, false\) = false/);
});

test("getDiscussionsInChannel omits the archive predicate when archived discussions are included", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, showArchived: true } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.doesNotMatch(driver.runCalls[0].query, /dc\.archived/);
});

// Unanswered filter tests
test("getDiscussionsInChannel omits inactive unanswered filtering", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(null, baseArgs as any, createMockContext(), null as unknown as GraphQLResolveInfo);

  assert.doesNotMatch(driver.runCalls[0].query, /dc\.answered/);
});

test("getDiscussionsInChannel filters for unanswered discussions", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, showUnanswered: true } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.match(driver.runCalls[0].query, /coalesce\(dc\.answered, false\) = false/);
});

// Download filter tests
test("getDiscussionsInChannel omits inactive download filtering", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(null, { ...baseArgs, hasDownload: null } as any, createMockContext(), null as unknown as GraphQLResolveInfo);

  assert.doesNotMatch(driver.runCalls[0].query, /discussion\.hasDownload/);
});

test("getDiscussionsInChannel filters for discussions with attached downloads", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, hasDownload: true } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.match(driver.runCalls[0].query, /discussion\.hasDownload = true/);
  assert.match(driver.runCalls[0].query, /HAS_DOWNLOADABLE_FILE/);
});

test("getDiscussionsInChannel filters out discussions marked as downloads", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, hasDownload: false } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.match(
    driver.runCalls[0].query,
    /discussion\.hasDownload = false OR discussion\.hasDownload IS NULL/
  );
});

// Label filters tests
test("getDiscussionsInChannel omits inactive label filtering", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(null, { ...baseArgs, labelFilters: [] } as any, createMockContext(), null as unknown as GraphQLResolveInfo);

  assert.equal(driver.runCalls[0].params.labelFilters, undefined);
  assert.doesNotMatch(driver.runCalls[0].query, /\$labelFilters/);
});

test("getDiscussionsInChannel passes label filters to query", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  const labelFilters = [
    { groupKey: "status", values: ["open", "in-progress"] },
    { groupKey: "priority", values: ["high"] },
  ];
  await resolver(
    null,
    { ...baseArgs, labelFilters } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.deepEqual(driver.runCalls[0].params.labelFilters, labelFilters);
  assert.match(driver.runCalls[0].query, /ALL\(labelFilter IN \$labelFilters/);
});

// Sort mode tests
test("getDiscussionsInChannel uses the compact new-sort query", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "new" } } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.match(driver.runCalls[0].query, /ORDER BY dc\.createdAt DESC/);
  assert.equal(driver.runCalls[0].params.startOfTimeFrame, undefined);
  assert.equal(driver.runCalls[0].params.hotAgeOffsetMonths, undefined);
});

test("getDiscussionsInChannel uses the top-sort query and time frame", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "top", timeFrame: "month" } } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.ok(driver.runCalls[0].params.startOfTimeFrame !== null);
  assert.match(driver.runCalls[0].query, /weightedVotesCount DESC/);
  assert.doesNotMatch(driver.runCalls[0].query, /hotRank/);
});

test("getDiscussionsInChannel uses the hot-sort query and ranking parameters", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "hot" } } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(driver.runCalls[0].params.hotAgeOffsetMonths, 2);
  assert.equal(driver.runCalls[0].params.hotGravity, 1.8);
  assert.match(driver.runCalls[0].query, /AS hotRank/);
});

test("getDiscussionsInChannel defaults to hot sort for unknown sort option", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, sort: "unknown" } } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.match(driver.runCalls[0].query, /AS hotRank/);
});

// Pagination tests
test("getDiscussionsInChannel passes offset and limit from options", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, options: { ...baseArgs.options, offset: "20", limit: "50" } } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(driver.runCalls[0].params.offset, 20);
  assert.equal(driver.runCalls[0].params.limit, 50);
});

// Channel name tests
test("getDiscussionsInChannel passes channel unique name to query", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await resolver(
    null,
    { ...baseArgs, channelUniqueName: "my-channel" } as any,
    createMockContext(),
    null as unknown as GraphQLResolveInfo
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
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  const result = await resolver(null, baseArgs as any, createMockContext(), null as unknown as GraphQLResolveInfo);

  assert.ok(result.discussionChannels);
  assert.equal(result.discussionChannels.length, 1);
  assert.deepEqual(result.discussionChannels[0], mockDiscussionChannel);
  assert.equal(result.aggregateDiscussionChannelsCount, 42);
});

test("getDiscussionsInChannel returns empty array and zero count when no results", async () => {
  const driver = createMockDriver([]);
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  const result = await resolver(null, baseArgs as any, createMockContext(), null as unknown as GraphQLResolveInfo);

  assert.deepEqual(result.discussionChannels, []);
  assert.equal(result.aggregateDiscussionChannelsCount, 0);
});

// Error handling tests
test("getDiscussionsInChannel throws error with message when query fails", async () => {
  const driver = {
    session: () => ({
      executeWrite: async (work: (transaction: { run: () => Promise<never> }) => Promise<unknown>) =>
        work({
          run: async () => {
            throw new Error("Database connection failed");
          },
        }),
      close: async () => {},
    }),
  };
  const resolver = getDiscussionsInChannelResolver({
    DiscussionChannel: {},
    driver,
  } as unknown as Parameters<typeof getDiscussionsInChannelResolver>[0]);

  await assert.rejects(
    () => resolver(null, baseArgs as any, createMockContext(), null as unknown as GraphQLResolveInfo),
    {
      message: /Failed to fetch discussionChannels in channel.*Database connection failed/,
    }
  );
});
