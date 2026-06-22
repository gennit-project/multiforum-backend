// Authenticated-role e2e: the highest-fidelity authorization test. It runs a
// real admin-gated mutation through the real schema + graphql-shield, against a
// live Neo4j, as three different callers:
//
//   1. unauthenticated        -> blocked by isAuthenticated (notAuthenticated)
//   2. authenticated non-admin -> passes isAuthenticated, blocked by isAdmin
//   3. authenticated admin     -> passes both; the resolver actually runs
//
// Case 2 is the one pure unit tests and the offline auth tests cannot reach:
// it proves the difference between "not logged in" and "logged in but not
// allowed" is wired correctly.
//
// Auth uses the app's built-in mock-auth seam (E2E_MOCK_AUTH=true), where a
// token is any JWT carrying username/email claims (decoded, not verified), and
// admin status is granted via the CYPRESS_ADMIN_TEST_EMAIL match.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { ERROR_MESSAGES } from "../../rules/errorMessages.js";

const ADMIN_EMAIL = "admin@e2e.test";
const SERVER_CONFIG_NAME = "E2ETestServer";

let container: StartedNeo4jContainer;
let schema: GraphQLSchema;
let driver: Driver;
let ogm: any;

before(async () => {
  // APOC is required: the OGM queries the permission rules run (suspension
  // lookups) call apoc.date.convertFormat.
  container = await new Neo4jContainer("neo4j:5-community").withApoc().start();

  // The schema helper builds its driver from these, so set them before import.
  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  process.env.E2E_MOCK_AUTH = "true";
  process.env.CYPRESS_ADMIN_TEST_EMAIL = ADMIN_EMAIL;
  process.env.SERVER_CONFIG_NAME = SERVER_CONFIG_NAME;

  const { buildPermissionedSchema } = await import(
    "../helpers/buildPermissionedSchema.js"
  );
  ({ schema, driver, ogm } = await buildPermissionedSchema());
  await ogm.init();

  const session = driver.session();
  try {
    await session.run("CREATE (:User { username: 'adminuser' })");
    await session.run("CREATE (:User { username: 'normaluser' })");
    await session.run("CREATE (:ServerConfig { serverName: $name })", {
      name: SERVER_CONFIG_NAME,
    });
  } finally {
    await session.close();
  }
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  await container?.stop();
});

const mockToken = (claims: Record<string, unknown>) =>
  `Bearer ${jwt.sign(claims, "mock-signing-key")}`;

// deleteServerConfigs is gated `and(isAuthenticated, isAdmin)`. The non-matching
// where clause makes the admit-path resolution a harmless no-op (deletes
// nothing) so the test is non-destructive.
const execDeleteServerConfigs = (authorization?: string) =>
  graphql({
    schema,
    source: `mutation {
      deleteServerConfigs(where: { serverName: "does-not-exist-xyz" }) {
        nodesDeleted
      }
    }`,
    contextValue: {
      driver,
      ogm,
      req: {
        headers: authorization ? { authorization } : {},
        body: {},
        isMutation: true,
      },
    },
  });

test("unauthenticated request is blocked by isAuthenticated", async () => {
  const result = await execDeleteServerConfigs(undefined);
  assert.ok(result.errors && result.errors.length > 0);
  assert.equal(
    result.errors[0].message,
    ERROR_MESSAGES.channel.notAuthenticated
  );
  assert.equal(result.data, null);
});

test("authenticated non-admin is blocked by isAdmin (not by isAuthenticated)", async () => {
  const result = await execDeleteServerConfigs(
    mockToken({ username: "normaluser", email: "normal@e2e.test" })
  );
  assert.ok(result.errors && result.errors.length > 0);
  // Denied by authorization, NOT authentication — this is the gap unit tests miss.
  assert.match(result.errors[0].message, /Not Authoris/i);
  assert.notEqual(
    result.errors[0].message,
    ERROR_MESSAGES.channel.notAuthenticated
  );
  assert.equal(result.data, null);
});

test("authenticated admin passes the shield and the resolver runs", async () => {
  const result = await execDeleteServerConfigs(
    mockToken({ username: "adminuser", email: ADMIN_EMAIL })
  );
  assert.equal(
    result.errors,
    undefined,
    `admin should not be blocked, got: ${JSON.stringify(result.errors)}`
  );
  const data = result.data as
    | { deleteServerConfigs?: { nodesDeleted?: number } }
    | null
    | undefined;
  assert.equal(data?.deleteServerConfigs?.nodesDeleted, 0);
});
