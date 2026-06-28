// Integration tests for the locked-channel content-creation block against live
// Neo4j. A locked forum is frozen: new discussions, events, and comments are
// rejected for everyone — including channel owners — until a server moderator
// unlocks it.
//
// The enforcement lives in checkChannelPermissions (the shared chokepoint that
// canCreateDiscussion / canCreateEvent / canCreateComment all funnel through),
// so we exercise that helper directly against a real database. This needs the
// OGM + live Neo4j because the gate reads the channel's `locked` flag from the
// graph. The end-to-end shield wiring of the create mutations is covered by the
// auth tests; here we prove the lock gate itself, across all three content
// permissions and against the channel-owner bypass.

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
import { checkChannelPermissions } from "../../rules/permission/hasChannelPermission.js";
import { ERROR_MESSAGES } from "../../rules/errorMessages.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
  // hasChannelPermission resolves the server-config default roles by this name
  // when it reaches the non-owner path; seed it so the unlocked control case is
  // deterministic.
  process.env.SERVER_CONFIG_NAME = "E2ETestServer";
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
  await run(`CREATE (:ServerConfig { serverName: 'E2ETestServer' })`);
  // owner1 is a channel admin (ADMIN_OF_CHANNEL) of both forums, so the "locked
  // blocks even owners" and "unlocked allows owners" cases differ only by the
  // channel's lock state.
  await run(`CREATE (:User { username: 'owner1' })`);
  await run(`CREATE (:User { username: 'member1' })`);
  await run(
    `CREATE (lc:Channel { uniqueName: 'locked-channel', displayName: 'Locked', locked: true })
     CREATE (oc:Channel { uniqueName: 'open-channel', displayName: 'Open', locked: false })
     WITH lc, oc
     MATCH (o:User { username: 'owner1' })
     CREATE (o)-[:ADMIN_OF_CHANNEL]->(lc)
     CREATE (o)-[:ADMIN_OF_CHANNEL]->(oc)`
  );
});

const contextFor = (username: string) =>
  modContext(env, mockToken({ username, email: `${username}@e2e.test` }));

const check = (channel: string, permission: string, username: string) =>
  checkChannelPermissions({
    channelConnections: [channel],
    context: contextFor(username) as any,
    permissionCheck: permission as any,
  });

test("a locked channel blocks discussion creation", async () => {
  const result = await check("locked-channel", "canCreateDiscussion", "member1");
  assert.equal(
    (result as Error).message,
    ERROR_MESSAGES.channel.locked
  );
});

test("a locked channel blocks event creation", async () => {
  const result = await check("locked-channel", "canCreateEvent", "member1");
  assert.equal(
    (result as Error).message,
    ERROR_MESSAGES.channel.locked
  );
});

test("a locked channel blocks comment creation", async () => {
  const result = await check("locked-channel", "canCreateComment", "member1");
  assert.equal(
    (result as Error).message,
    ERROR_MESSAGES.channel.locked
  );
});

test("a locked channel blocks even a channel owner (frozen for everyone)", async () => {
  const result = await check("locked-channel", "canCreateDiscussion", "owner1");
  assert.equal(
    (result as Error).message,
    ERROR_MESSAGES.channel.locked
  );
});

test("an unlocked channel allows a channel owner to create content (the gate is specific to lock state)", async () => {
  const result = await check("open-channel", "canCreateDiscussion", "owner1");
  assert.equal(result, true);
});
