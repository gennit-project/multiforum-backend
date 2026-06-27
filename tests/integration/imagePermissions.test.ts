// Permission-enforcement tests for the image moderation mutations, run through
// the REAL schema + graphql-shield against a live Neo4j (so the permission rules
// actually execute against seeded data). The resolver-direct integration tests
// exercise the happy path as a seeded moderator; these prove the security
// boundary: a logged-in user WITHOUT the relevant permission is denied — and is
// denied by the permission rule (not merely the isAuthenticated check).

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { mockToken } from "./imageModerationHarness.js";
import { ERROR_MESSAGES } from "../../rules/errorMessages.js";

const SERVER_CONFIG_NAME = "ImagePermTestServer";

let container: StartedNeo4jContainer;
let schema: GraphQLSchema;
let driver: Driver;
let ogm: any;

before(async () => {
  container = await new Neo4jContainer("neo4j:5-community").withApoc().start();
  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  process.env.E2E_MOCK_AUTH = "true";
  process.env.SERVER_CONFIG_NAME = SERVER_CONFIG_NAME;

  const { buildPermissionedSchema } = await import(
    "../helpers/buildPermissionedSchema.js"
  );
  ({ schema, driver, ogm } = await buildPermissionedSchema());
  await ogm.init();
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  await container?.stop();
});

beforeEach(async () => {
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
    await session.run(
      `CREATE (:ServerConfig { serverName: $serverName })
       CREATE (:User { username: 'regular' })
       CREATE (:Image { id: 'img-1', url: 'https://example.com/i.png' })`,
      { serverName: SERVER_CONFIG_NAME }
    );
  } finally {
    await session.close();
  }
});

const asUser = (username: string) => ({
  driver,
  ogm,
  req: {
    headers: {
      authorization: `Bearer ${mockToken({ username, email: `${username}@e2e.test` })}`,
    },
    body: {},
  },
});

const exec = (source: string, contextValue: unknown) =>
  graphql({ schema, source, contextValue });

// Helper: a denied-but-authenticated result has errors, nulls the field, and the
// error is NOT the not-authenticated message (which would mean the auth check,
// not the permission rule, blocked it).
const assertAuthenticatedDenial = (result: any, field: string) => {
  assert.ok(
    result.errors && result.errors.length > 0,
    `${field} should be denied`
  );
  assert.notEqual(
    result.errors[0].message,
    ERROR_MESSAGES.channel.notAuthenticated,
    `${field} should be denied by the permission rule, not the auth check (got: ${result.errors[0].message})`
  );
  assert.equal(result.data?.[field], null, `${field} resolver must not run`);
};

test("a logged-in non-moderator cannot archive an image", async () => {
  const result = await exec(
    `mutation {
       archiveImage(imageId: "img-1", selectedForumRules: [], selectedServerRules: ["No NSFW"], reportText: "x") { id }
     }`,
    asUser("regular")
  );

  assertAuthenticatedDenial(result, "archiveImage");

  // The image must not have been archived.
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (i:Image { id: 'img-1' }) RETURN coalesce(i.archived, false) AS archived`
    );
    assert.equal(res.records[0].get("archived"), false);
  } finally {
    await session.close();
  }
});

test("a logged-in non-moderator cannot unarchive an image", async () => {
  const result = await exec(
    `mutation { unarchiveImage(imageId: "img-1") { id } }`,
    asUser("regular")
  );

  assertAuthenticatedDenial(result, "unarchiveImage");
});

test("a logged-in non-moderator cannot permanently remove an image", async () => {
  const result = await exec(
    `mutation { permanentlyRemoveImage(imageId: "img-1") { id } }`,
    asUser("regular")
  );

  assertAuthenticatedDenial(result, "permanentlyRemoveImage");

  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (i:Image { id: 'img-1' }) RETURN coalesce(i.permanentlyRemoved, false) AS removed`
    );
    assert.equal(res.records[0].get("removed"), false);
  } finally {
    await session.close();
  }
});
