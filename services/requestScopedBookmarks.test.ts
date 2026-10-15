import assert from "node:assert/strict";
import test from "node:test";
import type {
  BookmarkManager,
  Driver,
  QueryConfig,
  SessionConfig,
} from "neo4j-driver";
import {
  getRequestBookmarkManager,
  installRequestScopedBookmarks,
  runWithRequestBookmarks,
} from "./requestScopedBookmarks.js";

type Calls = {
  sessions: Array<SessionConfig | undefined>;
  queries: Array<QueryConfig | undefined>;
};

const createDriver = () => {
  const calls: Calls = { sessions: [], queries: [] };
  const driver = {
    session: (config?: SessionConfig) => {
      calls.sessions.push(config);
      return { close: async () => undefined };
    },
    executeQuery: async (
      _query: unknown,
      _parameters?: unknown,
      config?: QueryConfig
    ) => {
      calls.queries.push(config);
      return { records: [] };
    },
  } as unknown as Driver;
  return { calls, driver: installRequestScopedBookmarks(driver) };
};

test("shares one bookmark manager across sessions and executeQuery in a request", async () => {
  const { calls, driver } = createDriver();

  await runWithRequestBookmarks(async () => {
    const manager = getRequestBookmarkManager();
    assert.ok(manager);

    driver.session({ defaultAccessMode: "WRITE" });
    driver.session({ defaultAccessMode: "READ" });
    await driver.executeQuery("RETURN 1", {}, { routing: "READ" });

    assert.equal(calls.sessions[0]?.bookmarkManager, manager);
    assert.equal(calls.sessions[1]?.bookmarkManager, manager);
    assert.equal(calls.queries[0]?.bookmarkManager, manager);
  });
});

test("isolates bookmark managers between concurrent requests", async () => {
  const release: Array<() => void> = [];
  const wait = () => new Promise<void>((resolve) => release.push(resolve));

  const requestA = runWithRequestBookmarks(async () => {
    const manager = getRequestBookmarkManager();
    await wait();
    return manager;
  });
  const requestB = runWithRequestBookmarks(async () => {
    const manager = getRequestBookmarkManager();
    await wait();
    return manager;
  });

  release.splice(0).forEach((resolve) => resolve());
  const [managerA, managerB] = await Promise.all([requestA, requestB]);

  assert.ok(managerA);
  assert.ok(managerB);
  assert.notEqual(managerA, managerB);
  assert.equal(getRequestBookmarkManager(), undefined);
});

test("leaves background sessions and queries unchanged", async () => {
  const { calls, driver } = createDriver();
  const explicitManager = {} as BookmarkManager;

  driver.session({ bookmarkManager: explicitManager });
  await driver.executeQuery("RETURN 1", {}, { bookmarkManager: null });

  assert.equal(calls.sessions[0]?.bookmarkManager, explicitManager);
  assert.equal(calls.queries[0]?.bookmarkManager, null);
});

test("replaces an explicit manager inside a request to preserve one causal chain", async () => {
  const { calls, driver } = createDriver();
  const unrelatedManager = {} as BookmarkManager;

  await runWithRequestBookmarks(async () => {
    const requestManager = getRequestBookmarkManager();
    driver.session({ bookmarkManager: unrelatedManager });
    await driver.executeQuery("RETURN 1", {}, {
      bookmarkManager: unrelatedManager,
    });

    assert.equal(calls.sessions[0]?.bookmarkManager, requestManager);
    assert.equal(calls.queries[0]?.bookmarkManager, requestManager);
  });
});
