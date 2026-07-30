import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import getDiscussionsInChannel from "./getDiscussionsInChannel.js";
import getSiteWideDiscussionList from "./getSiteWideDiscussionList.js";

const settingsJson = JSON.stringify({
  version: 1,
  discussionHot: {
    ageOffsetMonths: 3.5,
    gravity: 2.75,
  },
  commentHot: {
    ageOffsetMonths: 2,
    gravity: 1.8,
  },
});

const createDriver = () => {
  const runCalls: Array<{
    query: string;
    params: Record<string, unknown>;
  }> = [];

  return {
    runCalls,
    driver: {
      session: () => ({
        run: async (query: string, params: Record<string, unknown>) => {
          runCalls.push({ query, params });
          if (query.includes("RETURN serverConfig.rankingSettingsJson")) {
            return {
              records: [
                {
                  get: (key: string) =>
                    key === "settingsJson" ? settingsJson : null,
                },
              ],
            };
          }
          return { records: [] };
        },
        close: async () => {},
      }),
    },
  };
};

const assertDiscussionRankingParams = (
  runCalls: Array<{ params: Record<string, unknown> }>
) => {
  const rankingCall = runCalls.find(
    (call) => call.params.sortOption === "hot"
  );
  assert.ok(rankingCall);
  assert.equal(rankingCall.params.hotAgeOffsetMonths, 3.5);
  assert.equal(rankingCall.params.hotGravity, 2.75);
};

test("getSiteWideDiscussionList passes stored discussion ranking settings to Cypher", async () => {
  const mock = createDriver();
  const resolver = getSiteWideDiscussionList({
    driver: mock.driver as never,
    serverName: "test-server",
    Discussion: {} as never,
  });

  await resolver(
    null,
    {
      searchInput: "",
      selectedChannels: [],
      selectedTags: [],
      showArchived: false,
      hasDownload: false,
      options: {
        offset: "0",
        limit: "20",
        resultsOrder: "desc",
        sort: "hot",
        timeFrame:
          "week" as Parameters<typeof resolver>[1]["options"]["timeFrame"],
      },
    },
    {} as GraphQLContext,
    null as never
  );

  assertDiscussionRankingParams(mock.runCalls);
});

test("getDiscussionsInChannel passes stored discussion ranking settings to Cypher", async () => {
  const mock = createDriver();
  const resolver = getDiscussionsInChannel({
    driver: mock.driver as never,
    serverName: "test-server",
    DiscussionChannel: {} as never,
  });

  await resolver(
    null,
    {
      channelUniqueName: "general",
      selectedTags: [],
      searchInput: "",
      showArchived: false,
      showUnanswered: false,
      hasDownload: null,
      labelFilters: [],
      options: {
        offset: "0",
        limit: "20",
        sort: "hot",
        timeFrame:
          "week" as Parameters<typeof resolver>[1]["options"]["timeFrame"],
      },
    },
    {
      user: {
        username: "test-user",
      },
    } as GraphQLContext,
    null as never
  );

  assertDiscussionRankingParams(mock.runCalls);
});
