import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./intermediateNodeDeleteMiddleware.js";
import type { Driver } from "neo4j-driver";

const mutations = middleware.Mutation;

const makeDriver = () => {
  const calls: Array<{ query: string; params: Record<string, unknown> }> = [];
  const driver = {
    session: () => ({
      executeWrite: async (work: (tx: { run: Function }) => unknown) =>
        work({
          run: async (query: string, params: Record<string, unknown>) => {
            calls.push({ query, params });
            return { records: [{ get: () => ({ toNumber: () => 1 }) }] };
          },
        }),
      close: async () => undefined,
    }),
  } as unknown as Driver;
  return { calls, driver };
};

test("a successful discussion delete quarantines its connector by id", async () => {
  const { calls, driver } = makeDriver();
  const result = await mutations.deleteDiscussions(
    async () => ({ nodesDeleted: 1 }),
    null,
    { where: { id: "discussion-1" } },
    { driver } as never,
    {} as never
  );

  assert.deepEqual(result, { nodesDeleted: 1 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, { parentIds: ["discussion-1"] });
  assert.match(calls[0].query, /QuarantinedDiscussionChannel/);
});

test("a no-op event delete does not write quarantine data", async () => {
  const { calls, driver } = makeDriver();
  await mutations.deleteEvents(
    async () => ({ nodesDeleted: 0 }),
    null,
    { where: { id: "event-1" } },
    { driver } as never,
    {} as never
  );

  assert.equal(calls.length, 0);
});

test("a broad delete is rejected before it can create many orphans", async () => {
  const { driver } = makeDriver();
  let resolverCalled = false;
  await assert.rejects(
    mutations.deleteDiscussions(
      async () => {
        resolverCalled = true;
        return { nodesDeleted: 1 };
      },
      null,
      { where: {} },
      { driver } as never,
      {} as never
    ),
    /provide where\.id/
  );
  assert.equal(resolverCalled, false);
});
