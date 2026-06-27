// Integration tests for SERVER-scoped suspensions against live Neo4j. The admin
// "suspended users" / "suspended mods" pages read
// serverConfigs { SuspendedUsers/SuspendedMods { ... } }, so this covers the path
// the existing suspension.test.ts does not: an Issue with no Channel resolves to
// scope 'server', the Suspension is stamped with serverName (not channelUniqueName)
// and attached to the ServerConfig, and unsuspend detaches it from the ServerConfig.

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

// The resolvers attach server-scoped suspensions to the ServerConfig whose
// serverName === process.env.SERVER_CONFIG_NAME. Pin it for the test process.
const SERVER_NAME = "TestServer";

before(async () => {
  process.env.SERVER_CONFIG_NAME = SERVER_NAME;
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  // The acting moderator (must have a ModerationProfile).
  await seedModerator({ username: "mod1", modDisplayName: "Mod One" });
  // The ServerConfig that owns server-scoped suspensions.
  await run(`CREATE (:ServerConfig { serverName: $serverName })`, {
    serverName: SERVER_NAME,
  });
});

const ctx = () => modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }));

const suspendUser = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.suspendUser(
    null,
    { issueId: "srv-user-issue", suspendIndefinitely: true, explanation: "Server rule violation", ...args },
    ctx()
  );

const unsuspendUser = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.unsuspendUser(
    null,
    { issueId: "srv-user-issue", explanation: "Appeal granted", ...args },
    ctx()
  );

const suspendMod = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.suspendMod(
    null,
    { issueId: "srv-mod-issue", suspendIndefinitely: true, explanation: "Abuse of mod powers", ...args },
    ctx()
  );

const unsuspendMod = (args: Record<string, unknown> = {}) =>
  env.resolvers.Mutation.unsuspendMod(
    null,
    { issueId: "srv-mod-issue", explanation: "Appeal granted", ...args },
    ctx()
  );

// A server-scoped Issue has NO Channel relationship (scope resolves to 'server').
const seedServerUserIssue = () =>
  run(
    `CREATE (:User { username: 'baduser', displayName: 'Bad User' })
     CREATE (:Issue {
        id: 'srv-user-issue', issueNumber: 1, isOpen: true,
        relatedUsername: 'baduser', title: 'Server report against baduser',
        authorName: 'Mod One', createdAt: datetime()
     })`
  );

const seedServerModIssue = async () => {
  await seedModerator({ username: "badmoduser", modDisplayName: "BadMod", email: "badmod@e2e.test" });
  await run(
    `CREATE (:Issue {
        id: 'srv-mod-issue', issueNumber: 2, isOpen: true,
        relatedModProfileName: 'BadMod', title: 'Server report against BadMod',
        authorName: 'Mod One', createdAt: datetime()
     })`
  );
};

// --- server-scoped user suspension ---

test("suspendUser (server scope) creates a server-stamped Suspension on the ServerConfig", async () => {
  await seedServerUserIssue();

  await suspendUser();

  const suspensions = await run(
    `MATCH (s:Suspension { username: 'baduser' })
     RETURN s.serverName AS serverName, s.channelUniqueName AS channel, s.suspendedIndefinitely AS indefinite`
  );
  assert.equal(suspensions.length, 1, "one Suspension should be created");
  assert.equal(suspensions[0].serverName, SERVER_NAME, "stamped with the server name");
  assert.equal(suspensions[0].channel, null, "no channel for a server-scoped suspension");
  assert.equal(suspensions[0].indefinite, true);

  const attached = await run(
    `MATCH (:ServerConfig { serverName: $serverName })-[:SUSPENDED_AS_USER]->(s:Suspension { username: 'baduser' })
     RETURN count(s) AS n`,
    { serverName: SERVER_NAME }
  );
  assert.equal(Number(attached[0].n), 1, "suspension is attached to the ServerConfig");
});

test("suspendUser (server scope) links the suspension to the user and the related issue", async () => {
  await seedServerUserIssue();

  await suspendUser();

  const linked = await run(
    `MATCH (s:Suspension { username: 'baduser' })
     OPTIONAL MATCH (s)<-[:SUSPENDED_AS_USER]-(u:User { username: 'baduser' })
     OPTIONAL MATCH (s)-[:HAS_CONTEXT]->(i:Issue { id: 'srv-user-issue' })
     RETURN count(DISTINCT u) AS users, count(DISTINCT i) AS issues`
  );
  assert.equal(Number(linked[0].users), 1, "linked to the suspended user");
  assert.equal(Number(linked[0].issues), 1, "linked to the related issue");
});

test("suspendUser (server scope, temporary) records a suspendedUntil date", async () => {
  await seedServerUserIssue();

  const until = "2999-01-01T00:00:00.000Z";
  await suspendUser({ suspendIndefinitely: false, suspendUntil: until });

  // A temporary suspension records an expiry and is not indefinite — the
  // distinction the admin page renders ("Suspended until ..." vs "indefinitely").
  const suspensions = await run(
    `MATCH (s:Suspension { username: 'baduser' })
     RETURN s.suspendedIndefinitely AS indefinite, s.suspendedUntil IS NOT NULL AS hasUntil`
  );
  assert.equal(suspensions[0].indefinite, false, "a temporary suspension is not indefinite");
  assert.equal(suspensions[0].hasUntil, true, "records a suspendedUntil expiry");
});

test("unsuspendUser (server scope) detaches the suspension from the ServerConfig", async () => {
  await seedServerUserIssue();
  await suspendUser();

  await unsuspendUser();

  const attached = await run(
    `MATCH (:ServerConfig { serverName: $serverName })-[:SUSPENDED_AS_USER]->(s:Suspension { username: 'baduser' })
     RETURN count(s) AS n`,
    { serverName: SERVER_NAME }
  );
  assert.equal(Number(attached[0].n), 0, "suspension detached from the ServerConfig");

  const actions = await run(
    `MATCH (i:Issue { id: 'srv-user-issue' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok(
    (actions[0].types as string[]).includes("unsuspend"),
    `got ${JSON.stringify(actions[0].types)}`
  );
});

// --- server-scoped mod suspension ---

test("suspendMod (server scope) creates a server-stamped mod Suspension on the ServerConfig", async () => {
  await seedServerModIssue();

  await suspendMod();

  const suspensions = await run(
    `MATCH (s:Suspension { modProfileName: 'BadMod' })
     RETURN s.serverName AS serverName, s.channelUniqueName AS channel`
  );
  assert.equal(suspensions.length, 1, "one mod Suspension should be created");
  assert.equal(suspensions[0].serverName, SERVER_NAME);
  assert.equal(suspensions[0].channel, null);

  const attached = await run(
    `MATCH (:ServerConfig { serverName: $serverName })-[:SUSPENDED_AS_MOD]->(s:Suspension { modProfileName: 'BadMod' })
     OPTIONAL MATCH (s)<-[:SUSPENDED_AS_MOD]-(mp:ModerationProfile { displayName: 'BadMod' })
     RETURN count(DISTINCT s) AS suspensions, count(DISTINCT mp) AS mods`,
    { serverName: SERVER_NAME }
  );
  assert.equal(Number(attached[0].suspensions), 1, "attached to the ServerConfig");
  assert.equal(Number(attached[0].mods), 1, "linked to the moderation profile");
});

test("unsuspendMod (server scope) detaches the mod suspension from the ServerConfig", async () => {
  await seedServerModIssue();
  await suspendMod();

  await unsuspendMod();

  const attached = await run(
    `MATCH (:ServerConfig { serverName: $serverName })-[:SUSPENDED_AS_MOD]->(s:Suspension { modProfileName: 'BadMod' })
     RETURN count(s) AS n`,
    { serverName: SERVER_NAME }
  );
  assert.equal(Number(attached[0].n), 0, "mod suspension detached from the ServerConfig");
});
