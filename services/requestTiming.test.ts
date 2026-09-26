import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import {
  formatServerTiming,
  getRequestTiming,
  instrumentDriver,
  requestTimingPlugin,
  runWithRequestTiming,
} from "./requestTiming.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A Result stand-in: thenable like neo4j-driver's, and counts how many times
// its records were materialized so we can assert it is not consumed twice.
const createResult = () => {
  let materialized = 0;
  let promise: Promise<{ records: unknown[] }> | null = null;
  const result = {
    then: (
      onFulfilled: (value: { records: unknown[] }) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => {
      promise ??= delay(5).then(() => {
        materialized += 1;
        return { records: [] };
      });
      return promise.then(onFulfilled, onRejected);
    },
  };
  return { result, materialized: () => materialized };
};

const createDriver = () => {
  const { result, materialized } = createResult();
  const driver = {
    session: () => ({
      run: () => result,
      executeRead: async (work: () => Promise<unknown>) => {
        await delay(5);
        return work();
      },
      executeWrite: async (work: () => Promise<unknown>) => work(),
    }),
  } as unknown as Driver;
  return { driver: instrumentDriver(driver), result, materialized };
};

test("counts Neo4j calls made during a request", async () => {
  const { driver } = createDriver();

  const timing = await runWithRequestTiming(async () => {
    const session = driver.session();
    await session.executeRead(async () => "ok");
    await session.run("RETURN 1");
    await delay(1);
    return getRequestTiming();
  });

  assert.equal(timing?.dbCalls, 2);
});

test("attributes Neo4j time to the request", async () => {
  const { driver } = createDriver();

  const timing = await runWithRequestTiming(async () => {
    await driver.session().executeRead(async () => "ok");
    return getRequestTiming();
  });

  assert.ok((timing?.dbMs ?? 0) >= 4, `dbMs was ${timing?.dbMs}`);
});

test("returns the driver's own Result from run", () => {
  const { driver, result } = createDriver();

  const returned = runWithRequestTiming(() => driver.session().run("RETURN 1"));

  assert.equal(returned, result);
});

test("does not materialize a Result twice when the caller also awaits it", async () => {
  const { driver, materialized } = createDriver();

  await runWithRequestTiming(async () => {
    await driver.session().run("RETURN 1");
  });

  assert.equal(materialized(), 1);
});

test("formats a Server-Timing header", () => {
  assert.equal(
    formatServerTiming({
      queueMs: 1.24,
      parseMs: 0.5,
      validateMs: 2,
      executeMs: 30.06,
      totalMs: 34.5,
      dbMs: 12.3,
      dbCalls: 3,
    }),
    'queue;dur=1.2, parse;dur=0.5, validate;dur=2, execute;dur=30.1, db;dur=12.3;desc="3 calls", total;dur=34.5'
  );
});

test("the plugin sets a Server-Timing header with the request's db time", async () => {
  const { driver } = createDriver();
  const headers = new Map<string, string>();

  await runWithRequestTiming(async () => {
    const hooks = await requestTimingPlugin.requestDidStart!({} as never);
    const execution = await hooks!.executionDidStart!({} as never);
    await driver.session().executeRead(async () => "ok");
    await (execution as { executionDidEnd: () => Promise<void> }).executionDidEnd();
    await hooks!.willSendResponse!({
      request: { operationName: "getIssue", query: "query getIssue { x }" },
      response: { http: { headers } },
    } as never);
  });

  assert.match(headers.get("server-timing") ?? "", /db;dur=[\d.]+;desc="1 calls"/);
});
