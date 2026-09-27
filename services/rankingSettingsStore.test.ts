import assert from "node:assert/strict";
import test from "node:test";
import {
  getHotRankingQueryParams,
  invalidateRankingSettingsCache,
  RANKING_SETTINGS_CACHE_TTL_MS,
} from "./rankingSettingsStore.js";

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

test("hot sorts reuse a cached settings lookup until invalidated", async () => {
  invalidateRankingSettingsCache();
  let calls = 0;
  const executor = {
    run: async () => {
      calls += 1;
      return { records: [] };
    },
  };

  await getHotRankingQueryParams({
    executor: executor as never,
    profile: "discussion",
    sortOption: "hot",
    serverName: "cached-server",
  });
  await getHotRankingQueryParams({
    executor: executor as never,
    profile: "comment",
    sortOption: "hot",
    serverName: "cached-server",
  });

  assert.equal(calls, 1);

  invalidateRankingSettingsCache("cached-server");
  await getHotRankingQueryParams({
    executor: executor as never,
    profile: "discussion",
    sortOption: "hot",
    serverName: "cached-server",
  });
  assert.equal(calls, 2);
  assert.ok(RANKING_SETTINGS_CACHE_TTL_MS > 0);
});

test("concurrent hot sorts share one settings lookup", async () => {
  invalidateRankingSettingsCache();
  let calls = 0;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const executor = {
    run: async () => {
      calls += 1;
      await pending;
      return { records: [] };
    },
  };

  const requests = ["discussion", "comment"].map((profile) =>
    getHotRankingQueryParams({
      executor: executor as never,
      profile: profile as "discussion" | "comment",
      sortOption: "hot",
      serverName: "concurrent-server",
    })
  );
  release?.();
  await Promise.all(requests);

  assert.equal(calls, 1);
});

test("failed settings lookups are retried", async () => {
  invalidateRankingSettingsCache();
  let calls = 0;
  const executor = {
    run: async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return { records: [] };
    },
  };

  await assert.rejects(
    getHotRankingQueryParams({
      executor: executor as never,
      profile: "discussion",
      sortOption: "hot",
      serverName: "retry-server",
    }),
    /temporary failure/
  );
  await getHotRankingQueryParams({
    executor: executor as never,
    profile: "discussion",
    sortOption: "hot",
    serverName: "retry-server",
  });

  assert.equal(calls, 2);
});
