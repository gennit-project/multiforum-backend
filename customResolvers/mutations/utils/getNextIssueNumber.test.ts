import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import getNextIssueNumber from "./getNextIssueNumber.js";

const createDriver = (rawIssueNumber: unknown) => {
  const calls = {
    closed: false,
    query: "",
    params: null as Record<string, unknown> | null,
  };

  return {
    calls,
    driver: {
      session: () => ({
        executeWrite: async (callback: (tx: any) => Promise<any>) =>
          callback({
            run: async (query: string, params: Record<string, unknown>) => {
              calls.query = query;
              calls.params = params;
              return {
                records: [
                  {
                    get: () => rawIssueNumber,
                  },
                ],
              };
            },
          }),
        close: async () => {
          calls.closed = true;
        },
      }),
    },
  };
};

test("getNextIssueNumber returns numeric counter values", async () => {
  const { driver, calls } = createDriver(7);

  const result = await getNextIssueNumber(driver as any, "cats");

  assert.equal(result, 7);
  assert.equal(calls.params?.channelUniqueName, "cats");
  assert.match(calls.query, /MERGE \(counter:ChannelIssueCounter/);
  assert.equal(calls.closed, true);
});

test("getNextIssueNumber converts neo4j integers", async () => {
  const { driver } = createDriver(neo4j.int(12));

  const result = await getNextIssueNumber(driver as any, "cats");

  assert.equal(result, 12);
});

test("getNextIssueNumber rejects missing channel names", async () => {
  await assert.rejects(
    () => getNextIssueNumber(createDriver(1).driver as any, ""),
    /channelUniqueName is required/
  );
});

test("getNextIssueNumber closes the session when result parsing fails", async () => {
  const { driver, calls } = createDriver(null);

  await assert.rejects(
    () => getNextIssueNumber(driver as any, "cats"),
    /Failed to generate an issue number/
  );
  assert.equal(calls.closed, true);
});
