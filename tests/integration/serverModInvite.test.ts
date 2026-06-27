// Integration tests for the server-moderator invite flow against a live Neo4j
// container: inviteServerMod connects the invitee to ServerConfig.PendingModInvites
// (and attempts an email/notification, which no-ops without a mail provider),
// and acceptServerModInvite — run by the authenticated invitee — moves them from
// PendingModInvites to Moderators. The accept resolver uses the mock-auth seam
// and requires the caller to have a ModerationProfile.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  seedModerator,
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

const asMod = (username: string, email = "mod@test.com") =>
  modContext(env, mockToken({ username, email }));

const inviteServerMod = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.inviteServerMod(null, args, {});
const acceptServerModInvite = (args: Record<string, unknown>, ctx: any) =>
  env.resolvers.Mutation.acceptServerModInvite(null, args, ctx);
const cancelInviteServerMod = (args: Record<string, unknown>) =>
  env.resolvers.Mutation.cancelInviteServerMod(null, args, {});

const pendingInvitesFor = (serverName: string) =>
  run(
    `MATCH (:ServerConfig { serverName: $serverName })-[:HAS_PENDING_SERVER_MOD_INVITE]->(u:User)
     RETURN u.username AS username`,
    { serverName }
  );

const moderatorsOf = (serverName: string) =>
  run(
    `MATCH (mp:ModerationProfile)-[:MODERATOR_OF_SERVER]->(:ServerConfig { serverName: $serverName })
     RETURN mp.displayName AS displayName`,
    { serverName }
  );

// --- inviteServerMod ---

test("inviteServerMod adds the invitee to the server's pending mod invites", async () => {
  await run(
    `CREATE (:ServerConfig { serverName: 'srv' })
     CREATE (:User { username: 'invitee' })`
  );

  await inviteServerMod({ serverName: "srv", inviteeUsername: "invitee" });

  const pending = await pendingInvitesFor("srv");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].username, "invitee");
});

test("inviteServerMod returns false and adds no invite for an unknown server", async () => {
  await run(`CREATE (:User { username: 'invitee' })`);

  const result = await inviteServerMod({ serverName: "nope", inviteeUsername: "invitee" });
  assert.equal(result, false);
  assert.equal((await pendingInvitesFor("nope")).length, 0);
});

test("inviteServerMod throws when required arguments are missing", async () => {
  await assert.rejects(
    inviteServerMod({ serverName: "srv" }),
    /are required/i
  );
});

// --- acceptServerModInvite ---

test("acceptServerModInvite moves the moderator from pending invites to moderators", async () => {
  await seedModerator({ username: "invitee", modDisplayName: "InviteeMod", email: "mod@test.com" });
  await run(
    `MATCH (u:User { username: 'invitee' })
     CREATE (sc:ServerConfig { serverName: 'srv' })
     CREATE (sc)-[:HAS_PENDING_SERVER_MOD_INVITE]->(u)`
  );

  const result = await acceptServerModInvite({ serverName: "srv" }, asMod("invitee"));
  assert.equal(result, true);

  const mods = await moderatorsOf("srv");
  assert.equal(mods.length, 1, "the invitee's profile is now a server moderator");
  assert.equal(mods[0].displayName, "InviteeMod");

  assert.equal((await pendingInvitesFor("srv")).length, 0, "the pending invite is removed");
});

test("acceptServerModInvite rejects when there is no pending invite", async () => {
  await seedModerator({ username: "invitee", modDisplayName: "InviteeMod", email: "mod@test.com" });
  await run(`CREATE (:ServerConfig { serverName: 'srv' })`);

  await assert.rejects(
    acceptServerModInvite({ serverName: "srv" }, asMod("invitee")),
    /no pending moderator invite/i
  );

  assert.equal((await moderatorsOf("srv")).length, 0);
});

test("acceptServerModInvite rejects a caller who is not a moderator", async () => {
  await run(
    `CREATE (:User { username: 'plain' })
     CREATE (sc:ServerConfig { serverName: 'srv' })`
  );

  await assert.rejects(
    acceptServerModInvite({ serverName: "srv" }, asMod("plain")),
    /not a moderator/i
  );
});

// --- cancelInviteServerMod ---

test("cancelInviteServerMod removes a pending mod invite", async () => {
  await run(
    `CREATE (u:User { username: 'invitee' })
     CREATE (sc:ServerConfig { serverName: 'srv' })
     CREATE (sc)-[:HAS_PENDING_SERVER_MOD_INVITE]->(u)`
  );

  await cancelInviteServerMod({ serverName: "srv", inviteeUsername: "invitee" });

  assert.equal(
    (await pendingInvitesFor("srv")).length,
    0,
    "the pending invite is removed"
  );
  assert.equal(
    (await moderatorsOf("srv")).length,
    0,
    "the user did not become a moderator"
  );
});
