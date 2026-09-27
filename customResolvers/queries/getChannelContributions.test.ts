import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { getChannelContributionsQuery } from "../cypher/cypherQueries.js";
import getChannelContributionsResolver from "./getChannelContributions.js";

test("getChannelContributions executes only the contribution query", async () => {
  const runCalls: Array<{
    query: string;
    params: Record<string, unknown>;
  }> = [];
  const driver = {
    session: () => ({
      run: async (query: string, params: Record<string, unknown>) => {
        runCalls.push({ query, params });
        const values: Record<string, unknown> = {
          username: "alice",
          displayName: "Alice",
          profilePicURL: null,
          totalContributions: { toNumber: () => 1 },
          dayData: [],
        };
        return {
          records: [
            {
              get: (key: string) => values[key],
            },
          ],
        };
      },
      close: async () => {},
    }),
  } as unknown as Driver;
  const resolver = getChannelContributionsResolver({
    Channel: {
      find: async () => [{ uniqueName: "cats" }],
    } as any,
    driver,
  });
  const context = {
    mayAccessSensitiveContent: true,
  } as GraphQLContext;

  const result = await resolver(
    null,
    { channelUniqueName: "cats", limit: 10 },
    context
  );

  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].query, getChannelContributionsQuery);
  assert.equal(runCalls[0].params.channelUniqueName, "cats");
  assert.equal(result[0].username, "alice");
});
