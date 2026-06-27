// Integration tests for the server-admin invite flow against a live Neo4j
// container, mirroring serverModInvite.test.ts: inviteServerAdmin connects the
// invitee to ServerConfig.PendingAdminInvites; acceptServerAdminInvite — run by
// the authenticated invitee — moves them from PendingAdminInvites to Admins
// (no moderation profile required, unlike the mod flow); cancelInviteServerAdmin
// removes a pending invite.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  mockToken,
  modContext,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
});

// Server-admin acceptance only requires an authenticated user (no mod profile),
// so a plain context built from a mock token is enough.
const asUser = (username: string, email = "user@test.com") =>
  modContext(env, mockToken({ username, email }));

const inviteServerAdmin = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.inviteServerAdmin(null, args, {});
const acceptServerAdminInvite = (args: Record<string, unknown>, ctx: any) =>
  env.resolvers.Mutation.acceptServerAdminInvite(null, args, ctx);
const cancelInviteServerAdmin = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.cancelInviteServerAdmin(null, args, {});

const pendingAdminInvitesFor = (serverName: string) =>
  run(
    `MATCH (:ServerConfig { serverName: $serverName })-[:HAS_PENDING_SERVER_ADMIN_INVITE]->(u:User)
     RETURN u.username AS username`,
    { serverName }
  );

const adminsOf = (serverName: string) =>
  run(
    `MATCH (u:User)-[:ADMIN_OF_SERVER]->(:ServerConfig { serverName: $serverName })
     RETURN u.username AS username`,
    { serverName }
  );

// --- inviteServerAdmin ---

test("inviteServerAdmin adds the invitee to the server's pending admin invites", async () => {
  await run(
    `CREATE (:ServerConfig { serverName: 'srv' })
     CREATE (:User { username: 'invitee' })`
  );

  await inviteServerAdmin({ serverName: "srv", inviteeUsername: "invitee" });

  const pending = await pendingAdminInvitesFor("srv");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].username, "invitee");
});

test("inviteServerAdmin returns false and adds no invite for an unknown server", async () => {
  await run(`CREATE (:User { username: 'invitee' })`);

  const result = await inviteServerAdmin({ serverName: "nope", inviteeUsername: "invitee" });
  assert.equal(result, false);
  assert.equal((await pendingAdminInvitesFor("nope")).length, 0);
});

test("inviteServerAdmin throws when required arguments are missing", async () => {
  await assert.rejects(
    inviteServerAdmin({ serverName: "srv" }),
    /are required/i
  );
});

// --- acceptServerAdminInvite ---

test("acceptServerAdminInvite moves the user from pending invites to admins", async () => {
  await run(
    `CREATE (u:User { username: 'invitee' })
     CREATE (sc:ServerConfig { serverName: 'srv' })
     CREATE (sc)-[:HAS_PENDING_SERVER_ADMIN_INVITE]->(u)`
  );

  const result = await acceptServerAdminInvite({ serverName: "srv" }, asUser("invitee"));
  assert.equal(result, true);

  const admins = await adminsOf("srv");
  assert.equal(admins.length, 1, "the invitee is now a server admin");
  assert.equal(admins[0].username, "invitee");

  assert.equal((await pendingAdminInvitesFor("srv")).length, 0, "the pending invite is removed");
});

test("acceptServerAdminInvite rejects when there is no pending invite", async () => {
  await run(
    `CREATE (:User { username: 'invitee' })
     CREATE (:ServerConfig { serverName: 'srv' })`
  );

  await assert.rejects(
    acceptServerAdminInvite({ serverName: "srv" }, asUser("invitee")),
    /no pending admin invite/i
  );

  assert.equal((await adminsOf("srv")).length, 0);
});

test("acceptServerAdminInvite rejects an unauthenticated caller", async () => {
  await run(`CREATE (:ServerConfig { serverName: 'srv' })`);

  await assert.rejects(
    acceptServerAdminInvite({ serverName: "srv" }, {}),
    /must be logged in/i
  );
});

// --- cancelInviteServerAdmin ---

test("cancelInviteServerAdmin removes a pending admin invite", async () => {
  await run(
    `CREATE (u:User { username: 'invitee' })
     CREATE (sc:ServerConfig { serverName: 'srv' })
     CREATE (sc)-[:HAS_PENDING_SERVER_ADMIN_INVITE]->(u)`
  );

  await cancelInviteServerAdmin({ serverName: "srv", inviteeUsername: "invitee" });

  assert.equal(
    (await pendingAdminInvitesFor("srv")).length,
    0,
    "the pending invite is removed"
  );
  assert.equal((await adminsOf("srv")).length, 0, "the user did not become an admin");
});
