import test from "node:test";
import assert from "node:assert/strict";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, isInputObjectType } from "graphql";
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

const executeNotificationQuery = async (
  source: string,
  jwt?: Record<string, unknown>
) => {
  const capture: CapturedQuery = { cypher: "", params: {} };
  const driver = createCapturingDriver(capture);
  const schema = await new Neo4jGraphQL({ typeDefs, driver }).getSchema();
  const result = await graphql({
    schema,
    source,
    contextValue: { driver, ...(jwt ? { jwt } : {}) },
  });

  return { capture, result, schema };
};

test("Notification reads compile ownership into Cypher", async () => {
  const { capture, result } = await executeNotificationQuery(
    `query { notifications { id text } }`,
    { sub: "alice" }
  );

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    notifications: [],
  });
  assert.match(capture.cypher, /HAS_NOTIFICATION/);
  assert.match(capture.cypher, /username/);
  assert.deepEqual(capture.params.jwt, { sub: "alice" });
  assert.equal(capture.params.isAuthenticated, true);
});

test("Notification aggregate reads compile ownership into Cypher", async () => {
  const { capture, result } = await executeNotificationQuery(
    `query { notificationsAggregate { count } }`,
    { sub: "alice" }
  );

  // The capturing driver intentionally returns no aggregate row, so GraphQL
  // cannot materialize the non-null response. The generated Cypher and params
  // are the behavior under test here.
  assert.match(
    result.errors?.[0]?.message ?? "",
    /Cannot return null for non-nullable field Query\.notificationsAggregate/
  );
  assert.match(capture.cypher, /HAS_NOTIFICATION/);
  assert.match(capture.cypher, /username/);
  assert.deepEqual(capture.params.jwt, { sub: "alice" });
});

test("nested Notification reads and aggregates use the verified caller", async () => {
  const { capture, result } = await executeNotificationQuery(
    `query {
      users(where: { username: "bob" }) {
        Notifications { id }
        NotificationsAggregate { count }
      }
    }`,
    { sub: "alice" }
  );

  assert.deepEqual(result.errors, undefined);
  assert.match(capture.cypher, /HAS_NOTIFICATION/);
  assert.match(capture.cypher, /username/);
  assert.deepEqual(capture.params.jwt, { sub: "alice" });
  assert.match(JSON.stringify(capture.params), /bob/);
});

test("Notification reads without an identity compile a fail-closed predicate", async () => {
  const { capture, result } = await executeNotificationQuery(
    `query { notifications { id } }`
  );

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    notifications: [],
  });
  assert.equal(capture.params.isAuthenticated, false);
});

test("Notification reads fail closed when only unrelated server claims exist", async () => {
  const { capture, result } = await executeNotificationQuery(
    `query { notifications { id } }`,
    { mayAccessSensitiveContent: true }
  );

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    notifications: [],
  });
  assert.deepEqual(capture.params.jwt, { mayAccessSensitiveContent: true });
});

test("Notification ownership cannot be reassigned through generated mutations", async () => {
  const { schema } = await executeNotificationQuery(`query { __typename }`);

  for (const inputName of ["NotificationCreateInput", "NotificationUpdateInput"]) {
    const input = schema.getType(inputName);
    assert.ok(isInputObjectType(input), `${inputName} should be an input object`);
    assert.equal(
      input.getFields().User,
      undefined,
      `${inputName}.User must remain server-owned`
    );
  }
});
