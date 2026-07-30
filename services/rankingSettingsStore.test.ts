import assert from "node:assert/strict";
import test from "node:test";
import { getHotRankingQueryParams } from "./rankingSettingsStore.js";

test("non-hot sorts use defaults without reading stored settings", async () => {
  let calls = 0;
  const executor = {
    run: async () => {
      calls += 1;
      return { records: [] };
    },
  };

  const params = await getHotRankingQueryParams({
    executor: executor as never,
    profile: "discussion",
    sortOption: "new",
    serverName: "test-server",
  });

  assert.deepEqual(params, {
    hotAgeOffsetMonths: 2,
    hotGravity: 1.8,
  });
  assert.equal(calls, 0);
});

test("hot sorts load the selected profile from stored server settings", async () => {
  const settingsJson = JSON.stringify({
    version: 1,
    discussionHot: {
      ageOffsetMonths: 4,
      gravity: 2.5,
    },
    commentHot: {
      ageOffsetMonths: 0.75,
      gravity: 1.2,
    },
  });
  const executor = {
    run: async () => ({
      records: [
        {
          get: (key: string) => (key === "settingsJson" ? settingsJson : null),
        },
      ],
    }),
  };

  assert.deepEqual(
    await getHotRankingQueryParams({
      executor: executor as never,
      profile: "discussion",
      sortOption: "hot",
      serverName: "test-server",
    }),
    {
      hotAgeOffsetMonths: 4,
      hotGravity: 2.5,
    }
  );
  assert.deepEqual(
    await getHotRankingQueryParams({
      executor: executor as never,
      profile: "comment",
      sortOption: "hot",
      serverName: "test-server",
    }),
    {
      hotAgeOffsetMonths: 0.75,
      hotGravity: 1.2,
    }
  );
});

test("hot sorts fall back to defaults when the server config is absent", async () => {
  const executor = {
    run: async () => ({ records: [] }),
  };

  assert.deepEqual(
    await getHotRankingQueryParams({
      executor: executor as never,
      profile: "comment",
      sortOption: "hot",
      serverName: "missing-server",
    }),
    {
      hotAgeOffsetMonths: 2,
      hotGravity: 1.8,
    }
  );
});
