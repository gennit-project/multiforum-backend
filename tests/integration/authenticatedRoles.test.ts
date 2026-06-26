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

  // Provision the default roles so a non-admin resolves the real
  // DefaultServerRole (which lacks the admin capabilities) — exercising the
  // post-migration permission path that the capability checks rely on.
  const { provisionServerDefaults } = await import(
    "../../seedData/provisionServerDefaults.js"
  );
  await provisionServerDefaults({
    ServerRole: ogm.model("ServerRole"),
    ModServerRole: ogm.model("ModServerRole"),
    ServerConfig: ogm.model("ServerConfig"),
    serverName: SERVER_CONFIG_NAME,
  });
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  await container?.stop();
});

const mockToken = (claims: Record<string, unknown>) =>
  `Bearer ${jwt.sign(claims, "mock-signing-key")}`;

// deleteServerConfigs is gated `and(isAuthenticated, canManageServerSettings)`.
// The non-matching
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

test("authenticated non-admin is blocked by the capability check (not by isAuthenticated)", async () => {
  const result = await execDeleteServerConfigs(
    mockToken({ username: "normaluser", email: "normal@e2e.test" })
  );
  assert.ok(result.errors && result.errors.length > 0);
  // Denied by authorization (canManageServerSettings), NOT authentication — the
  // non-admin resolves DefaultServerRole, which lacks the capability.
  assert.equal(
    result.errors[0].message,
    ERROR_MESSAGES.server.noServerPermission
  );
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

// --- Resource-ownership gate: deleteComments = and(isAuthenticated, or(isAdmin, isCommentAuthor)) ---
//
// The ownership analogue of the admin test above. isCommentAuthor reads the
// comment's CommentAuthor from the DB and compares it to the caller, so this
// exercises the full path: shield rule -> live OGM lookup -> allow/deny. Each
// test seeds its own comment so the admit case (which actually deletes) cannot
// affect the deny cases regardless of run order.

const seedComment = async (id: string, authorUsername: string) => {
  const session = driver.session();
  try {
    await session.run(
      `MATCH (u:User { username: $authorUsername })
       CREATE (c:Comment { id: $id, text: 'hello', isRootComment: true, createdAt: datetime() })
       CREATE (u)-[:AUTHORED_COMMENT]->(c)`,
      { id, authorUsername }
    );
  } finally {
    await session.close();
  }
};

const countComment = async (id: string): Promise<number> => {
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (c:Comment { id: $id }) RETURN count(c) AS n`,
      { id }
    );
    return res.records[0].get("n").toNumber();
  } finally {
    await session.close();
  }
};

const execDeleteComments = (id: string, authorization?: string) =>
  graphql({
    schema,
    source: `mutation ($id: ID!) {
      deleteComments(where: { id: $id }) { nodesDeleted }
    }`,
    variableValues: { id },
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

test("deleteComments: unauthenticated request is blocked by isAuthenticated", async () => {
  await seedComment("c-unauth", "normaluser");
  const result = await execDeleteComments("c-unauth");
  assert.ok(result.errors && result.errors.length > 0);
  assert.equal(result.errors[0].message, ERROR_MESSAGES.channel.notAuthenticated);
  assert.equal(await countComment("c-unauth"), 1, "comment must survive a denied delete");
});

test("deleteComments: authenticated non-author non-admin is blocked by isCommentAuthor", async () => {
  await seedComment("c-other", "normaluser");
  const result = await execDeleteComments(
    "c-other",
    mockToken({ username: "adminuser", email: "not-admin-here@e2e.test" })
  );
  // adminuser is not an admin here (email doesn't match) and is not the author,
  // so both branches of the or() fail -> shield's default deny.
  assert.ok(result.errors && result.errors.length > 0);
  assert.match(result.errors[0].message, /Not Authoris/i);
  assert.notEqual(result.errors[0].message, ERROR_MESSAGES.channel.notAuthenticated);
  assert.equal(await countComment("c-other"), 1, "comment must survive a denied delete");
});

test("deleteComments: the comment author passes isCommentAuthor and the resolver deletes it", async () => {
  await seedComment("c-own", "normaluser");
  const result = await execDeleteComments(
    "c-own",
    mockToken({ username: "normaluser", email: "normal@e2e.test" })
  );
  assert.equal(
    result.errors,
    undefined,
    `author should not be blocked, got: ${JSON.stringify(result.errors)}`
  );
  const data = result.data as { deleteComments?: { nodesDeleted?: number } } | null;
  assert.equal(data?.deleteComments?.nodesDeleted, 1);
  assert.equal(await countComment("c-own"), 0, "the author's comment should be deleted");
});

// --- Account-owner + input-validation gate:
//     updateUsers = and(isAuthenticated, updateUserInputIsValid, or(isAccountOwner, isAdmin))
//
// Adds two paths the comment gate above doesn't reach:
//   - isAccountOwner DENIES BY THROWING (not by returning false), exercising
//     shield's or() over a throwing rule.
//   - an input-validation gate (updateUserInputIsValid) that can deny an
//     otherwise-authorized owner purely on bad input.

const readBio = async (username: string): Promise<string | null> => {
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (u:User { username: $username }) RETURN u.bio AS bio`,
      { username }
    );
    return res.records[0]?.get("bio") ?? null;
  } finally {
    await session.close();
  }
};

const execUpdateUserBio = (username: string, bio: string, authorization?: string) =>
  graphql({
    schema,
    source: `mutation ($username: String!, $bio: String!) {
      updateUsers(where: { username: $username }, update: { bio: $bio }) {
        users { username bio }
      }
    }`,
    variableValues: { username, bio },
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

test("updateUsers: authenticated non-owner is blocked by isAccountOwner (throwing branch of or())", async () => {
  const result = await execUpdateUserBio(
    "normaluser",
    "hacked bio",
    mockToken({ username: "adminuser", email: "not-admin-here@e2e.test" })
  );
  assert.ok(result.errors && result.errors.length > 0);
  assert.notEqual(result.errors[0].message, ERROR_MESSAGES.channel.notAuthenticated);
  assert.notEqual(await readBio("normaluser"), "hacked bio", "non-owner must not change another user's bio");
});

test("updateUsers: the account owner passes and the resolver updates the bio", async () => {
  const result = await execUpdateUserBio(
    "normaluser",
    "my new bio",
    mockToken({ username: "normaluser", email: "normal@e2e.test" })
  );
  assert.equal(
    result.errors,
    undefined,
    `owner should not be blocked, got: ${JSON.stringify(result.errors)}`
  );
  assert.equal(await readBio("normaluser"), "my new bio");
});

test("updateUsers: an over-length bio is blocked by updateUserInputIsValid even for the owner", async () => {
  const longBio = "x".repeat(501); // MAX_CHARS_IN_USER_BIO is 500
  const result = await execUpdateUserBio(
    "normaluser",
    longBio,
    mockToken({ username: "normaluser", email: "normal@e2e.test" })
  );
  assert.ok(result.errors && result.errors.length > 0);
  assert.match(result.errors[0].message, /bio cannot exceed/i);
  assert.notEqual(await readBio("normaluser"), longBio, "invalid bio must not be persisted");
});
