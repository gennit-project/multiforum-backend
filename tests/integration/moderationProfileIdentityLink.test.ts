// Pseudonymity guard: a ModerationProfile's activity/history is public for
// transparency, but the link between a mod profile and the real account
// (username, email) must not be discoverable through the API in EITHER
// direction. This runs real queries through the wired schema + graphql-shield
// layer and asserts:
//   - anonymous callers cannot resolve the User behind a ModerationProfile
//     (ModerationProfile.User: deny), nor the ModerationProfile behind a User
//     (User.ModerationProfile: isAccountOwner)
//   - even an authenticated non-owner cannot resolve someone else's mod profile
//   - the account OWNER can still resolve their own mod profile (needed by the
//     registration/self flows), proving the gate is self-scoped, not a blanket
//     removal of the field
//   - the mod -> user edge is one-way-denied even for the owner, so a mod
//     profile can never be used to reach the user's email
//
// These paths resolve real list data, so a Neo4j container is required.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import jwt from "jsonwebtoken";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";

const USERNAME = "linkeduser";
const MOD_PROFILE = "PseudoMod";
const EMAIL = "secret@e2e.test";
const OTHER_USERNAME = "otheruser";

let container: StartedNeo4jContainer;
let schema: GraphQLSchema;
let driver: Driver;
let ogm: any;

before(async () => {
  container = await new Neo4jContainer("neo4j:5-community")
    .withApoc()
    .withStartupTimeout(240000)
    .start();
  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  // Use the app's mock-auth seam so a signed test JWT is decoded for its
  // username/email claims instead of being verified against Auth0.
  process.env.E2E_MOCK_AUTH = "true";

  const { buildPermissionedSchema } = await import(
    "../helpers/buildPermissionedSchema.js"
  );
  ({ schema, driver, ogm } = await buildPermissionedSchema());
  await ogm.init();

  // The container's "ready" signal can fire a moment before Bolt actually
  // accepts queries; poll a trivial query so the first real write doesn't race
  // the driver's connection pool.
  for (let attempt = 0; ; attempt += 1) {
    const probe = driver.session();
    try {
      await probe.run("RETURN 1");
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      await probe.close();
    }
  }

  const session = driver.session();
  try {
    // A user whose real identity (username + email) is linked to a pseudonymous
    // moderation profile, plus an unrelated second user used for the
    // authenticated-non-owner case.
    await session.run(
      `CREATE (u:User { username: $username })
       CREATE (mp:ModerationProfile { displayName: $modProfile, createdAt: datetime() })
       CREATE (u)-[:MODERATION_PROFILE]->(mp)
       CREATE (e:Email { address: $email })
       CREATE (e)-[:HAS_EMAIL]->(u)
       CREATE (:User { username: $other })`,
      { username: USERNAME, modProfile: MOD_PROFILE, email: EMAIL, other: OTHER_USERNAME }
    );
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

// The executed queries return dynamically shaped data, so the result is cast
// to `any` for indexing (matching the other integration tests).
const exec = async (source: string, authorization?: string) => {
  const result = await graphql({
    schema,
    source,
    contextValue: {
      driver,
      ogm,
      req: {
        headers: authorization ? { authorization } : {},
        body: {},
        isMutation: false,
      },
    },
  });
  return { data: result.data as any, errors: result.errors };
};

const MOD_TO_USER = `query {
  moderationProfiles(where: { displayName: "${MOD_PROFILE}" }) {
    displayName
    User { username }
  }
}`;

const USER_TO_MOD = `query {
  users(where: { username: "${USERNAME}" }) {
    username
    ModerationProfile { displayName }
  }
}`;

const MOD_TO_EMAIL = `query {
  moderationProfiles(where: { displayName: "${MOD_PROFILE}" }) {
    User { Email { address } }
  }
}`;

test("public transparency field on a moderation profile still resolves", async () => {
  const result = await exec(MOD_TO_USER);
  assert.equal(result.data?.moderationProfiles?.[0]?.displayName, MOD_PROFILE);
});

test("anonymous caller cannot resolve the user behind a moderation profile", async () => {
  const result = await exec(MOD_TO_USER);
  assert.equal(result.data?.moderationProfiles?.[0]?.User, null);
});

test("anonymous caller cannot resolve the moderation profile behind a user", async () => {
  const result = await exec(USER_TO_MOD);
  assert.equal(result.data?.users?.[0]?.ModerationProfile, null);
});

test("public username field on a user still resolves", async () => {
  const result = await exec(USER_TO_MOD);
  assert.equal(result.data?.users?.[0]?.username, USERNAME);
});

test("an authenticated non-owner cannot resolve someone else's moderation profile", async () => {
  const result = await exec(
    USER_TO_MOD,
    mockToken({ username: OTHER_USERNAME, email: "other@e2e.test" })
  );
  assert.equal(result.data?.users?.[0]?.ModerationProfile, null);
});

test("the account owner can resolve their own moderation profile", async () => {
  const result = await exec(
    USER_TO_MOD,
    mockToken({ username: USERNAME, email: EMAIL })
  );
  assert.equal(
    result.data?.users?.[0]?.ModerationProfile?.displayName,
    MOD_PROFILE
  );
});

test("the mod -> user edge is denied even for the account owner (one-way)", async () => {
  const result = await exec(
    MOD_TO_EMAIL,
    mockToken({ username: USERNAME, email: EMAIL })
  );
  assert.equal(result.data?.moderationProfiles?.[0]?.User, null);
});
