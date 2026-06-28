// Suspension ENFORCEMENT e2e: runs real mutations through the real schema +
// graphql-shield against a live Neo4j, as a SUSPENDED caller, proving that the
// suspension actually blocks the action (and that the gate re-opens once the
// suspension expires or is removed).
//
// The suspension *data lifecycle* (suspendUser/unsuspendUser graph effects) is
// covered by suspension.test.ts / serverSuspension.test.ts, and the permission
// *logic* by the rules/permission unit tests. What those cannot prove is the
// wiring: that a suspended user hitting a real mutation through shield is denied,
// that a blocked attempt creates the notification, and that expiry/removal lets
// the action through. That is this file.
//
// Mechanism: a channel-scoped suspension makes hasChannelPermission resolve the
// channelSuspended role (denies create/upvote); a server-scoped suspension makes
// hasServerPermission resolve the serverSuspended role (denies canCreateChannel).
// Both roles come from provisionServerDefaults (seedData/defaultRoles.ts). The
// caller is a normal (non-admin) user, so the server-admin override never applies.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import { ERROR_MESSAGES } from "../../rules/errorMessages.js";

const ADMIN_EMAIL = "admin@susp.test"; // a DIFFERENT identity than any caller below
const SERVER_CONFIG_NAME = "SuspensionTestServer";
const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let container: StartedNeo4jContainer;
let schema: GraphQLSchema;
let driver: Driver;
let ogm: any;

before(async () => {
  let builder = new Neo4jContainer("neo4j:5-community").withApoc();
  if (REUSE) builder = builder.withReuse();
  container = await builder.start();

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

  await run(
    `CREATE (:ServerConfig { serverName: $name, enableDownloads: true, allowedFileTypes: [] })
     CREATE (:User { username: 'normaluser' })`,
    { name: SERVER_CONFIG_NAME }
  );

  // Provisions DefaultServerRole/DefaultChannelRole (grant create/upvote) and the
  // serverSuspended/channelSuspended roles (deny them) used by the gates above.
  const { provisionServerDefaultsFromOgm } = await import(
    "../../seedData/provisionServerDefaults.js"
  );
  await provisionServerDefaultsFromOgm(ogm, { serverName: SERVER_CONFIG_NAME });
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  if (!REUSE) await container?.stop();
});

async function run(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, any>[]> {
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
}

const token = (username: string, email: string) =>
  `Bearer ${jwt.sign({ username, email }, "mock-signing-key")}`;

const exec = (
  source: string,
  variableValues: Record<string, unknown>,
  caller: { username: string; email: string }
) =>
  graphql({
    schema,
    source,
    variableValues,
    contextValue: {
      driver,
      ogm,
      req: {
        headers: { authorization: token(caller.username, caller.email) },
        body: {},
        isMutation: true,
      },
    },
  });

const firstErrorMessage = (result: Awaited<ReturnType<typeof graphql>>) =>
  result.errors?.[0]?.message;

// --- seed helpers -----------------------------------------------------------

// A channel-scoped suspension: Channel + User both point at the Suspension via
// SUSPENDED_AS_USER, and the Suspension has the related Issue as context — the
// exact shape getActiveSuspension's Cypher matches.
const seedChannelSuspension = (opts: {
  channel: string;
  username: string;
  email: string;
  issueNumber: number;
  indefinite?: boolean;
  suspendedUntil?: string | null;
}) =>
  run(
    `CREATE (ch:Channel { uniqueName: $channel, createdAt: datetime() })
     MERGE (u:User { username: $username })
     CREATE (i:Issue { id: $issueId, issueNumber: $issueNumber, isOpen: false, channelUniqueName: $channel, relatedUsername: $username, title: 'Report', authorName: 'mod', createdAt: datetime() })
     CREATE (s:Suspension { id: $susId, username: $username, suspendedIndefinitely: $indefinite, suspendedUntil: $suspendedUntil })
     CREATE (ch)-[:SUSPENDED_AS_USER]->(s)
     CREATE (u)-[:SUSPENDED_AS_USER]->(s)
     CREATE (s)-[:HAS_CONTEXT]->(i)
     CREATE (ch)-[:HAS_ISSUE]->(i)`,
    {
      channel: opts.channel,
      username: opts.username,
      issueId: `issue-${opts.channel}`,
      issueNumber: opts.issueNumber,
      susId: `sus-${opts.channel}`,
      indefinite: opts.indefinite ?? false,
      suspendedUntil: opts.suspendedUntil ?? null,
    }
  );

const seedServerSuspension = (opts: {
  username: string;
  issueNumber: number;
  indefinite?: boolean;
}) =>
  run(
    `MATCH (sc:ServerConfig { serverName: $name })
     MERGE (u:User { username: $username })
     CREATE (i:Issue { id: $issueId, issueNumber: $issueNumber, isOpen: false, relatedUsername: $username, title: 'Server report', authorName: 'mod', createdAt: datetime() })
     CREATE (s:Suspension { id: $susId, username: $username, suspendedIndefinitely: $indefinite, suspendedUntil: null })
     CREATE (sc)-[:SUSPENDED_AS_USER]->(s)
     CREATE (u)-[:SUSPENDED_AS_USER]->(s)
     CREATE (s)-[:HAS_CONTEXT]->(i)`,
    {
      name: SERVER_CONFIG_NAME,
      username: opts.username,
      issueId: `srv-issue-${opts.username}`,
      issueNumber: opts.issueNumber,
      susId: `srv-sus-${opts.username}`,
      indefinite: opts.indefinite ?? true,
    }
  );

const seedCommentInChannel = (channel: string, commentId: string) =>
  run(
    `MERGE (ch:Channel { uniqueName: $channel }) ON CREATE SET ch.createdAt = datetime()
     CREATE (c:Comment { id: $commentId, text: 'hi', isRootComment: true, createdAt: datetime() })
     CREATE (ch)-[:HAS_COMMENT]->(c)`,
    { channel, commentId }
  );

const seedDiscussionChannel = (channel: string, dcId: string) =>
  run(
    `MERGE (ch:Channel { uniqueName: $channel }) ON CREATE SET ch.createdAt = datetime()
     CREATE (:DiscussionChannel { id: $dcId, channelUniqueName: $channel, createdAt: datetime() })`,
    { channel, dcId }
  );

const notificationsFor = (username: string) =>
  run(
    `MATCH (:User { username: $username })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.text AS text`,
    { username }
  );

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- operations -------------------------------------------------------------

const CREATE_CHANNELS = `
  mutation ($input: [ChannelCreateInput!]!) {
    createChannels(input: $input) { channels { uniqueName } }
  }
`;
const ADD_EMOJI_TO_COMMENT = `
  mutation ($commentId: ID!, $emojiLabel: String!, $unicode: String!, $username: String!) {
    addEmojiToComment(commentId: $commentId, emojiLabel: $emojiLabel, unicode: $unicode, username: $username) { id }
  }
`;
const ADD_EMOJI_TO_DISCUSSION_CHANNEL = `
  mutation ($discussionChannelId: ID!, $emojiLabel: String!, $unicode: String!, $username: String!) {
    addEmojiToDiscussionChannel(discussionChannelId: $discussionChannelId, emojiLabel: $emojiLabel, unicode: $unicode, username: $username) { id }
  }
`;
const CREATE_DISCUSSION = `
  mutation ($input: [DiscussionCreateInputWithChannels!]!) {
    createDiscussionWithChannelConnections(input: $input) { id }
  }
`;

const discussionInput = (channel: string, username: string) => [
  {
    discussionCreateInput: {
      title: "A discussion",
      Author: { connect: { where: { node: { username } } } },
    },
    channelConnections: [channel],
  },
];

const addEmojiToCommentVars = (commentId: string, username: string) => ({
  commentId,
  emojiLabel: "thumbsup",
  unicode: "👍",
  username,
});

// ===========================================================================
// Workflow 1: server-scoped suspension blocks forum creation
// ===========================================================================

test("a server-suspended user is blocked from creating a forum", async () => {
  const user = { username: "srvSuspended", email: "srv@susp.test" };
  await seedServerSuspension({ username: user.username, issueNumber: 11 });

  const result = await exec(CREATE_CHANNELS, { input: [{ uniqueName: "srvblocked" }] }, user);

  assert.equal(firstErrorMessage(result), ERROR_MESSAGES.server.noServerPermission);
  const created = await run(`MATCH (ch:Channel { uniqueName: 'srvblocked' }) RETURN count(ch) AS n`);
  assert.equal(Number(created[0].n), 0, "no channel should be created");
});

// Also a cross-user regression guard: this runs after another user has been
// server-suspended above, so it proves one user's server suspension does not
// leak onto a different (non-suspended) user.
test("a non-suspended user is NOT blocked from creating a forum", async () => {
  const result = await exec(
    CREATE_CHANNELS,
    { input: [{ uniqueName: "allowedforum" }] },
    { username: "normaluser", email: "normal@susp.test" }
  );

  // The forum-creation gate must not deny a normal user.
  assert.notEqual(firstErrorMessage(result), ERROR_MESSAGES.server.noServerPermission);
});

// ===========================================================================
// Workflow 2: channel-scoped suspension blocks emoji reactions
// ===========================================================================

test("a channel-suspended user is blocked from adding an emoji to a comment", async () => {
  const user = { username: "emojiSuspended", email: "emoji@susp.test" };
  await seedChannelSuspension({ channel: "emoji-ch", username: user.username, email: user.email, issueNumber: 21, indefinite: true });
  await seedCommentInChannel("emoji-ch", "emoji-comment");

  const result = await exec(ADD_EMOJI_TO_COMMENT, addEmojiToCommentVars("emoji-comment", user.username), user);

  assert.equal(firstErrorMessage(result), ERROR_MESSAGES.channel.noChannelPermission);
});

test("a channel-suspended user is blocked from adding an emoji to a discussion", async () => {
  const user = { username: "emojiDiscSuspended", email: "emojidisc@susp.test" };
  await seedChannelSuspension({ channel: "emoji-disc-ch", username: user.username, email: user.email, issueNumber: 22, indefinite: true });
  await seedDiscussionChannel("emoji-disc-ch", "emoji-dc");

  const result = await exec(
    ADD_EMOJI_TO_DISCUSSION_CHANNEL,
    { discussionChannelId: "emoji-dc", emojiLabel: "thumbsup", unicode: "👍", username: user.username },
    user
  );

  assert.equal(firstErrorMessage(result), ERROR_MESSAGES.channel.noChannelPermission);
});

test("a non-suspended user is NOT blocked from adding an emoji to a comment", async () => {
  await seedCommentInChannel("emoji-ok-ch", "emoji-ok-comment");

  const result = await exec(
    ADD_EMOJI_TO_COMMENT,
    addEmojiToCommentVars("emoji-ok-comment", "normaluser"),
    { username: "normaluser", email: "normal@susp.test" }
  );

  assert.notEqual(firstErrorMessage(result), ERROR_MESSAGES.channel.noChannelPermission);
});

// Cross-user regression: a suspension is per-user. One user being suspended in a
// channel must not block a DIFFERENT, non-suspended user in the same channel.
test("one user's channel suspension does not block another user in the same channel", async () => {
  await seedChannelSuspension({ channel: "shared-ch", username: "suspendedNeighbor", email: "neighbor@susp.test", issueNumber: 24, indefinite: true });
  await seedCommentInChannel("shared-ch", "shared-comment");

  const result = await exec(
    ADD_EMOJI_TO_COMMENT,
    addEmojiToCommentVars("shared-comment", "normaluser"),
    { username: "normaluser", email: "normal@susp.test" }
  );

  assert.notEqual(firstErrorMessage(result), ERROR_MESSAGES.channel.noChannelPermission);
});

// ===========================================================================
// Workflow 3: a blocked action notifies the suspended user
// ===========================================================================

test("a blocked channel action notifies the suspended user with a forum issue link", async () => {
  const user = { username: "notifyChannel", email: "notifych@susp.test" };
  await seedChannelSuspension({ channel: "notify-ch", username: user.username, email: user.email, issueNumber: 31, indefinite: true });

  await exec(CREATE_DISCUSSION, { input: discussionInput("notify-ch", user.username) }, user);

  const notes = await notificationsFor(user.username);
  assert.equal(notes.length, 1, `expected one notification, got ${JSON.stringify(notes)}`);
  assert.match(notes[0].text, /cannot canCreateDiscussion/);
  assert.match(notes[0].text, /\/forums\/notify-ch\/issues\/31/);
});

test("a blocked server action notifies the suspended user with an admin issue link", async () => {
  const user = { username: "notifyServer", email: "notifysrv@susp.test" };
  await seedServerSuspension({ username: user.username, issueNumber: 32 });

  await exec(CREATE_CHANNELS, { input: [{ uniqueName: "notifyblocked" }] }, user);

  const notes = await notificationsFor(user.username);
  assert.equal(notes.length, 1, `expected one notification, got ${JSON.stringify(notes)}`);
  assert.match(notes[0].text, /\/admin\/issues\/32/);
});

test("a suspended user who opted out of suspension notifications is not notified", async () => {
  const user = { username: "optedOut", email: "optout@susp.test" };
  await seedChannelSuspension({ channel: "optout-ch", username: user.username, email: user.email, issueNumber: 33, indefinite: true });
  await run(`MATCH (u:User { username: $u }) SET u.notifyOnSuspensionBlocks = false`, { u: user.username });

  await exec(CREATE_DISCUSSION, { input: discussionInput("optout-ch", user.username) }, user);

  const notes = await notificationsFor(user.username);
  assert.equal(notes.length, 0, "opted-out user should receive no suspension notification");
});

// ===========================================================================
// Workflow 4: expiration boundary + automatic cleanup
// ===========================================================================

test("a future-dated time-limited suspension still blocks the action", async () => {
  const user = { username: "futureSuspended", email: "future@susp.test" };
  await seedChannelSuspension({
    channel: "future-ch",
    username: user.username,
    email: user.email,
    issueNumber: 41,
    suspendedUntil: "2999-01-01T00:00:00.000Z",
  });

  const result = await exec(CREATE_DISCUSSION, { input: discussionInput("future-ch", user.username) }, user);

  assert.equal(firstErrorMessage(result), ERROR_MESSAGES.channel.noChannelPermission);
});

test("an expired time-limited suspension no longer blocks the action", async () => {
  const user = { username: "expiredSuspended", email: "expired@susp.test" };
  await seedChannelSuspension({
    channel: "expired-ch",
    username: user.username,
    email: user.email,
    issueNumber: 42,
    suspendedUntil: "2000-01-01T00:00:00.000Z", // in the past
  });

  const result = await exec(CREATE_DISCUSSION, { input: discussionInput("expired-ch", user.username) }, user);

  // The expired suspension must not deny the action.
  assert.notEqual(firstErrorMessage(result), ERROR_MESSAGES.channel.noChannelPermission);
});

test("an expired suspension is automatically disconnected from the channel", async () => {
  const user = { username: "cleanupSuspended", email: "cleanup@susp.test" };
  await seedChannelSuspension({
    channel: "cleanup-ch",
    username: user.username,
    email: user.email,
    issueNumber: 43,
    suspendedUntil: "2000-01-01T00:00:00.000Z",
  });

  // Trigger a permission check, which fires the (async) cleanup.
  await exec(CREATE_DISCUSSION, { input: discussionInput("cleanup-ch", user.username) }, user);

  // Cleanup is fire-and-forget, so poll for the relationship to be removed.
  let remaining = 1;
  for (let i = 0; i < 25 && remaining > 0; i++) {
    const rows = await run(
      `MATCH (:Channel { uniqueName: 'cleanup-ch' })-[:SUSPENDED_AS_USER]->(s:Suspension) RETURN count(s) AS n`
    );
    remaining = Number(rows[0].n);
    if (remaining > 0) await wait(200);
  }
  assert.equal(remaining, 0, "expired suspension should be disconnected from the channel");
});

// ===========================================================================
// Workflow 5: once the suspension is removed, the gate re-opens
// ===========================================================================

test("after the suspension is removed, the previously-blocked action is allowed", async () => {
  const user = { username: "recoverUser", email: "recover@susp.test" };
  await seedChannelSuspension({ channel: "recover-ch", username: user.username, email: user.email, issueNumber: 51, indefinite: true });

  const blocked = await exec(CREATE_DISCUSSION, { input: discussionInput("recover-ch", user.username) }, user);
  assert.equal(firstErrorMessage(blocked), ERROR_MESSAGES.channel.noChannelPermission, "should be blocked while suspended");

  // Remove the suspension (the unsuspend resolver's graph effect — detaching the
  // Suspension — is covered in suspension.test.ts; here we verify the gate
  // re-opens on the next check with no caching).
  await run(`MATCH (s:Suspension { id: 'sus-recover-ch' }) DETACH DELETE s`);

  const allowed = await exec(CREATE_DISCUSSION, { input: discussionInput("recover-ch", user.username) }, user);
  assert.notEqual(firstErrorMessage(allowed), ERROR_MESSAGES.channel.noChannelPermission, "should be allowed after removal");
});
