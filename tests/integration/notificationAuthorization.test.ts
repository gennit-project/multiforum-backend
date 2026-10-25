import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

let driver: Driver;
let schema: GraphQLSchema;

before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ typeDefs, driver }).getSchema();
}, { timeout: 240000 });

after(async () => {
  await stopNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);

  const session = driver.session();
  try {
    await session.run(`
      CREATE (alice:User { username: "alice" })
      CREATE (bob:User { username: "bob" })
      CREATE (aliceNotification:Notification {
        id: "alice-notification",
        createdAt: datetime(),
        read: false,
        text: "for alice",
        notificationType: "mention"
      })
      CREATE (bobNotification:Notification {
        id: "bob-notification",
        createdAt: datetime(),
        read: false,
        text: "for bob",
        notificationType: "mention"
      })
      CREATE (alice)-[:HAS_NOTIFICATION]->(aliceNotification)
      CREATE (bob)-[:HAS_NOTIFICATION]->(bobNotification)
    `);
  } finally {
    await session.close();
  }
});

const execute = (source: string, username?: string) =>
  graphql({
    schema,
    source,
    contextValue: {
      driver,
      ...(username ? { jwt: { sub: username } } : {}),
    },
  });

test("notification reads return only the verified caller's rows", async () => {
  const result = await execute(
    `query {
      notifications { id text }
      notificationsConnection { aggregate { count { nodes } } }
      users(where: { username: { eq: "bob" } }) {
        Notifications { id }
        NotificationsConnection { aggregate { count { nodes } } }
      }
    }`,
    "alice"
  );

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    notifications: [{ id: "alice-notification", text: "for alice" }],
    notificationsConnection: { aggregate: { count: { nodes: 1 } } },
    users: [{ Notifications: [], NotificationsConnection: { aggregate: { count: { nodes: 0 } } } }],
  });
});

test("notification reads fail closed without a verified caller", async () => {
  const result = await execute(`query {
    notifications { id }
    notificationsConnection { aggregate { count { nodes } } }
  }`);

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    notifications: [],
    notificationsConnection: { aggregate: { count: { nodes: 0 } } },
  });
});
