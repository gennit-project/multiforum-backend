import assert from "node:assert/strict";
import test from "node:test";
import { int, type Integer } from "neo4j-driver";
import getUserWikiEditsCountResolver from "./getUserWikiEditsCount.js";

type RunCall = {
  query: string;
  params: Record<string, unknown>;
};

const createDriver = (count: number | Integer | null | undefined) => {
  const runCalls: RunCall[] = [];

  return {
    runCalls,
    driver: {
      session: () => ({
        run: async (query: string, params: Record<string, unknown>) => {
          runCalls.push({ query, params });
          return {
            records: [
              {
                get: (key: string) =>
                  key === "count"
                    ? count
                    : undefined,
              },
            ],
          };
        },
        close: async () => {},
      }),
    },
  };
};

test("getUserWikiEditsCount returns the counted wiki edits for an existing user", async () => {
  const { driver, runCalls } = createDriver(int(3));
  const resolver = getUserWikiEditsCountResolver({
    contributionTargetRepository: {
      userExists: async () => true,
      channelExists: async () => false,
      moderationProfileExists: async () => false,
    },
    driver: driver as any,
  });

  const result = await resolver(null, { username: "alice" });

  assert.equal(result, 3);
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].params.username, "alice");
  assert.match(runCalls[0].query, /AUTHORED_VERSION/);
  assert.match(runCalls[0].query, /WikiPage/);
});

test("getUserWikiEditsCount throws when the user does not exist", async () => {
  const { driver } = createDriver(0);
  const resolver = getUserWikiEditsCountResolver({
    contributionTargetRepository: {
      userExists: async () => false,
      channelExists: async () => false,
      moderationProfileExists: async () => false,
    },
    driver: driver as any,
  });

  await assert.rejects(
    resolver(null, { username: "ghost" }),
    /not found|Failed to fetch wiki edits count/i
  );
});

for (const [value, expected] of [[3, 3], [null, 0], [undefined, 0]] as const) {
  test(`getUserWikiEditsCount retains native/missing COUNT normalization: ${value}`, async () => {
    const { driver } = createDriver(value);
    const resolver = getUserWikiEditsCountResolver({
      driver: driver as any,
      contributionTargetRepository: {
        userExists: async () => true,
        channelExists: async () => false,
        moderationProfileExists: async () => false,
      },
    });
    assert.equal(await resolver(null, { username: "alice" }), expected);
  });
}
