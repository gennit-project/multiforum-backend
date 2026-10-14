import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { createEventsFromInput } from "./createEventWithChannelConnections.js";

const buildDriver = (callbackAttempts = 1, failRun = false) => {
  const calls = {
    executeWrite: 0,
    runs: [] as Record<string, unknown>[],
    close: 0,
  };
  const driver = {
    session: () => ({
      executeWrite: async (
        work: (transaction: {
          run: (query: string, params: Record<string, unknown>) => Promise<object>;
        }) => Promise<string>
      ) => {
        calls.executeWrite += 1;
        let result = "";
        for (let attempt = 0; attempt < callbackAttempts; attempt += 1) {
          result = await work({
            run: async (_query, params) => {
              calls.runs.push(params);
              if (failRun) {
                throw new Error("channel write failed");
              }
              return {};
            },
          });
        }
        return result;
      },
      close: async () => {
        calls.close += 1;
      },
    }),
  };
  return { driver: driver as unknown as Driver, calls };
};

const event = {
  id: "event-1",
  title: "Meetup",
  EventChannels: [],
};

test("createEventsFromInput creates the event and channel links in one managed write", async () => {
  const { driver, calls } = buildDriver();
  const createCalls: Record<string, unknown>[] = [];
  const Event = {
    create: async (input: Record<string, unknown>) => {
      createCalls.push(input);
      return { events: [event] };
    },
    find: async () => [event],
  };

  const result = await createEventsFromInput(
    Event as never,
    driver,
    [{ eventCreateInput: { title: "Meetup" } as never, channelConnections: ["general", "events"] }],
    { user: { username: "alice" } } as unknown as GraphQLContext
  );

  assert.deepEqual(result, [event]);
  assert.equal(calls.executeWrite, 1);
  assert.equal(calls.runs.length, 2);
  assert.ok((createCalls[0].context as { executionContext?: unknown }).executionContext);
  assert.equal(calls.close, 1);
});

test("createEventsFromInput is safe when Neo4j retries the callback", async () => {
  const { driver, calls } = buildDriver(2);
  let createCalls = 0;
  const Event = {
    create: async () => {
      createCalls += 1;
      return { events: [event] };
    },
    find: async () => [event],
  };

  const result = await createEventsFromInput(
    Event as never,
    driver,
    [{ eventCreateInput: { title: "Meetup" } as never, channelConnections: ["general"] }],
    { user: { username: "alice" } } as unknown as GraphQLContext
  );

  assert.deepEqual(result, [event]);
  assert.equal(createCalls, 2);
  assert.equal(calls.runs.length, 2);
  assert.equal(calls.close, 1);
});

test("createEventsFromInput does not return a partially linked event", async () => {
  const { driver, calls } = buildDriver(1, true);
  let findCalls = 0;
  const Event = {
    create: async () => ({ events: [event] }),
    find: async () => {
      findCalls += 1;
      return [event];
    },
  };

  const result = await createEventsFromInput(
    Event as never,
    driver,
    [{ eventCreateInput: { title: "Meetup" } as never, channelConnections: ["general"] }],
    { user: { username: "alice" } } as unknown as GraphQLContext
  );

  assert.deepEqual(result, []);
  assert.equal(findCalls, 0);
  assert.equal(calls.close, 1);
});
