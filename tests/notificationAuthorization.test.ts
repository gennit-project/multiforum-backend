import test from "node:test";
import assert from "node:assert/strict";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql } from "graphql";
import type { Driver } from "neo4j-driver";
import typeDefs from "../typeDefs.js";

type CapturedQuery = {
  cypher: string;
  params: Record<string, unknown>;
};

const createCapturingDriver = (capture: CapturedQuery): Driver => {
  const summary = {
    counters: { updates: () => ({}) },
  };
  const transaction = {
    run: async (cypher: string, params: Record<string, unknown>) => {
      if (cypher.includes("dbms.components")) {
        return { records: [["5.26.0", "enterprise"]], summary };
      }

      capture.cypher = cypher;
      capture.params = params;
      return { records: [], summary };
    },
  };
  const session = {
    executeRead: async (
      work: (tx: typeof transaction) => Promise<{ records: unknown[] }>
    ) => work(transaction),
    executeWrite: async (
      work: (tx: typeof transaction) => Promise<{ records: unknown[] }>
    ) => work(transaction),
    lastBookmarks: () => [],
    close: async () => undefined,
  };

  return {
    session: () => session,
    executeQueryBookmarkManager: undefined,
  } as unknown as Driver;
};

test("Notification reads compile ownership into Cypher", async () => {
  const capture: CapturedQuery = { cypher: "", params: {} };
  const driver = createCapturingDriver(capture);
  const schema = await new Neo4jGraphQL({ typeDefs, driver }).getSchema();

  const result = await graphql({
    schema,
    source: `query { notifications { id text } }`,
    contextValue: {
      driver,
      jwt: { sub: "alice" },
    },
  });

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    notifications: [],
  });
  assert.match(capture.cypher, /HAS_NOTIFICATION/);
  assert.match(capture.cypher, /username/);
  assert.deepEqual(capture.params.jwt, { sub: "alice" });
  assert.equal(capture.params.isAuthenticated, true);
});

test("Notification reads without an identity compile a fail-closed predicate", async () => {
  const capture: CapturedQuery = { cypher: "", params: {} };
  const driver = createCapturingDriver(capture);
  const schema = await new Neo4jGraphQL({ typeDefs, driver }).getSchema();

  const result = await graphql({
    schema,
    source: `query { notifications { id } }`,
    contextValue: { driver },
  });

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    notifications: [],
  });
  assert.equal(capture.params.isAuthenticated, false);
});
