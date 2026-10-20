// Integration tests for moderator-suspension permission enforcement against live
// Neo4j.
//
// The pure role-selection decision (suspended > elevated > default) is unit
// tested in hasChannelModPermission.test.ts with mocked data. These tests prove
// the enforcement end-to-end against a real graph via checkChannelModPermissions
// (the shared chokepoint), and verify the lifecycle: deny while suspended,
// re-grant once lifted, and auto-re-grant + cleanup once a time-limited
// suspension expires. They also prove the mod/user separation — a suspended
// ModerationProfile must not touch the same person's user-scope permissions.

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
import { checkChannelModPermissions, ModChannelPermission } from "../../rules/permission/hasChannelModPermission.js";
import { checkChannelPermissions } from "../../rules/permission/hasChannelPermission.js";
import { getActiveSuspension } from "../../rules/permission/getActiveSuspension.js";
import { createChannelPermissionRepository } from "../../services/persistence/channelPermissionRepository.js";
import { disconnectExpiredSuspensions } from "../../rules/permission/disconnectExpiredSuspensions.js";
import { createSuspensionEffectsRepository } from "../../services/persistence/suspensionEffectsRepository.js";

const CHANNEL = "cats";
const MOD_USER = "moddy";
const MOD_PROFILE = "ModdyProfile";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
  process.env.SERVER_CONFIG_NAME = "E2ETestServer";
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  // A channel whose default mod role grants the mod actions, and whose default
  // user role grants commenting — so a non-suspended mod is allowed, and the
  // same person (as a user) can comment.
  await run(
    `CREATE (:ServerConfig { serverName: 'E2ETestServer' })
     CREATE (ch:Channel { uniqueName: $channel, displayName: 'Cats', locked: false, createdAt: datetime() })
     CREATE (modRole:ModChannelRole {
       id: 'cats-default-mod',
       name: 'Default Moderator',
       channelUniqueName: $channel,
       canHideComment: true,
       canEditDiscussions: true
     })
     CREATE (userRole:ChannelRole {
       id: 'cats-default-user',
       name: 'Default User',
       channelUniqueName: $channel,
       canCreateComment: true
     })
     CREATE (ch)-[:HAS_DEFAULT_MOD_ROLE]->(modRole)
     CREATE (ch)-[:HAS_DEFAULT_CHANNEL_ROLE]->(userRole)
     CREATE (ch)-[:OWNS_MOD_CHANNEL_ROLE]->(modRole)
     CREATE (ch)-[:OWNS_CHANNEL_ROLE]->(userRole)
     CREATE (u:User { username: $modUser, createdAt: datetime() })
     CREATE (mp:ModerationProfile { displayName: $modProfile })
     CREATE (u)-[:MODERATION_PROFILE]->(mp)`,
    { channel: CHANNEL, modUser: MOD_USER, modProfile: MOD_PROFILE }
  );
});

const ctx = (username: string) =>
  modContext(env, mockToken({ username, email: `${username}@e2e.test` })) as any;

const modCan = (permission: string) =>
  checkChannelModPermissions({
    channelConnections: [CHANNEL],
    context: ctx(MOD_USER),
    permissionCheck: permission as any,
  });

const userCan = (permission: string) =>
  checkChannelPermissions({
    channelConnections: [CHANNEL],
    context: ctx(MOD_USER),
    permissionCheck: permission as any,
  });

// Suspends the mod profile in the channel. `suspendedUntil` null => indefinite.
const suspendMod = (suspendedUntil: string | null) =>
  run(
    `MATCH (ch:Channel { uniqueName: $channel })
     CREATE (s:Suspension {
       id: 'mod-suspension-1',
       modProfileName: $modProfile,
       suspendedIndefinitely: $indefinite,
       suspendedUntil: $suspendedUntil,
       createdAt: datetime()
     })
     CREATE (ch)-[:SUSPENDED_AS_MOD]->(s)`,
    {
      channel: CHANNEL,
      modProfile: MOD_PROFILE,
      indefinite: suspendedUntil === null,
      suspendedUntil,
    }
  );

const suspendedModEdgeCount = async () => {
  const rows = await run(
    `MATCH (:Channel { uniqueName: $channel })-[r:SUSPENDED_AS_MOD]->(:Suspension)
     RETURN count(r) AS n`,
    { channel: CHANNEL }
  );
  return Number(rows[0].n);
};

test("a moderator with the default mod role can hide a comment (control)", async () => {
  assert.equal(await modCan("canHideComment"), true);
});

test("a suspended mod is denied mod actions", async () => {
  await suspendMod(null);
  assert.ok(
    (await modCan("canHideComment")) instanceof Error,
    "canHideComment should be denied"
  );
  assert.ok(
    (await modCan("canEditDiscussions")) instanceof Error,
    "canEditDiscussions should be denied"
  );
});

test("lifting the suspension re-grants the mod permission", async () => {
  await suspendMod(null);
  assert.ok((await modCan("canHideComment")) instanceof Error);

  // Lift the suspension (detach + remove the node).
  await run(
    `MATCH (:Channel { uniqueName: $channel })-[r:SUSPENDED_AS_MOD]->(s:Suspension)
     DELETE r, s`,
    { channel: CHANNEL }
  );

  assert.equal(await modCan("canHideComment"), true);
});

test("an expired time-limited mod suspension auto-re-grants the permission", async () => {
  // suspendedUntil in the past, not indefinite.
  await suspendMod("2000-01-01T00:00:00.000Z");
  const context = ctx(MOD_USER);
  const effects = createSuspensionEffectsRepository(env.driver);
  let cleanup: Promise<void> | undefined;
  context.suspensionEffectsRepository = {
    ...effects,
    disconnectExpiredChannelSuspensions(
      input: Parameters<typeof effects.disconnectExpiredChannelSuspensions>[0]
    ) {
      cleanup = effects.disconnectExpiredChannelSuspensions(input);
      return cleanup;
    },
  };

  try {
    assert.equal(await checkChannelModPermissions({
      channelConnections: [CHANNEL],
      context,
      permissionCheck: ModChannelPermission.canHideComment,
    }), true);
    assert.ok(cleanup, "expired suspension cleanup should be scheduled");
  } finally {
    // Permission checks deliberately do not await cleanup. Drain it before
    // the next test resets and recreates the same channel/suspension IDs,
    // otherwise this old cleanup can disconnect the next fixture's edge.
    await cleanup;
  }
  assert.equal(await suspendedModEdgeCount(), 0);
});

test("an expired mod suspension is detected and cleaned up from the channel", async () => {
  await suspendMod("2000-01-01T00:00:00.000Z");

  const info = await getActiveSuspension({
    repository: createChannelPermissionRepository(env.driver),
    channelUniqueName: CHANNEL,
    modProfileName: MOD_PROFILE,
  });
  assert.equal(info.isSuspended, false);
  assert.equal(info.expiredModSuspensions.length, 1);

  await disconnectExpiredSuspensions({
    driver: env.driver,
    channelUniqueName: CHANNEL,
    expiredUserSuspensions: info.expiredUserSuspensions,
    expiredModSuspensions: info.expiredModSuspensions,
  });

  assert.equal(await suspendedModEdgeCount(), 0);
});

test("a mod suspension does not block the same person's user-scope permissions", async () => {
  await suspendMod(null);
  // Mod-scope action is denied...
  assert.ok((await modCan("canHideComment")) instanceof Error);
  // ...but the user-scope action (commenting as themselves) is allowed.
  assert.equal(await userCan("canCreateComment"), true);
});
