// Integration tests for the content-unarchive moderation resolvers against live
// Neo4j: unarchiveDiscussion, unarchiveEvent (and unarchiveComment). Each finds
// an existing Issue for archived content, flips the archived flag back, records
// an "un-archive" ModerationAction, and closes the issue.

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
  await seedModerator({ username: "mod1", modDisplayName: "Mod One" });
});

const ctx = () => modContext(env, mockToken({ username: "mod1", email: "mod1@e2e.test" }));

const seedIssue = (related: Record<string, string>) => {
  const props = Object.entries(related)
    .map(([k, v]) => `${k}: '${v}'`)
    .join(", ");
  return run(
    `CREATE (i:Issue { id: 'issue-1', issueNumber: 1, isOpen: true, createdAt: datetime(),
        channelUniqueName: 'test-channel', title: 'Archived content', authorName: 'Mod One', ${props} })`
  );
};

const actionTypes = async () => {
  const rows = await run(
    `MATCH (i:Issue { id: 'issue-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  return (rows[0]?.types || []) as string[];
};

// --- unarchiveDiscussion ---

test("unarchiveDiscussion flips DiscussionChannel.archived and closes the issue", async () => {
  await run(
    `CREATE (:DiscussionChannel { id: 'dc-1', discussionId: 'disc-1', channelUniqueName: 'test-channel', archived: true, createdAt: datetime() })`
  );
  await seedIssue({ relatedDiscussionId: "disc-1" });

  await env.resolvers.Mutation.unarchiveDiscussion(
    null,
    { discussionId: "disc-1", channelUniqueName: "test-channel", explanation: "Reinstating" },
    ctx()
  );

  const dc = await run(
    `MATCH (d:DiscussionChannel { discussionId: 'disc-1', channelUniqueName: 'test-channel' }) RETURN d.archived AS archived`
  );
  assert.equal(dc[0].archived, false);

  const issue = await run(`MATCH (i:Issue { id: 'issue-1' }) RETURN i.isOpen AS isOpen`);
  assert.equal(issue[0].isOpen, false);
  assert.ok((await actionTypes()).includes("un-archive"));
});

test("unarchiveDiscussion throws when no issue exists", async () => {
  await run(
    `CREATE (:DiscussionChannel { id: 'dc-1', discussionId: 'disc-1', channelUniqueName: 'test-channel', archived: true, createdAt: datetime() })`
  );
  await assert.rejects(
    env.resolvers.Mutation.unarchiveDiscussion(
      null,
      { discussionId: "disc-1", channelUniqueName: "test-channel", explanation: "x" },
      ctx()
    ),
    /Issue not found/i
  );
});

// --- unarchiveEvent ---

test("unarchiveEvent flips EventChannel.archived and closes the issue", async () => {
  await run(
    `CREATE (:EventChannel { id: 'ec-1', eventId: 'event-1', channelUniqueName: 'test-channel', archived: true, createdAt: datetime() })`
  );
  await seedIssue({ relatedEventId: "event-1" });

  await env.resolvers.Mutation.unarchiveEvent(
    null,
    { eventId: "event-1", channelUniqueName: "test-channel", explanation: "Reinstating" },
    ctx()
  );

  const ec = await run(
    `MATCH (e:EventChannel { eventId: 'event-1', channelUniqueName: 'test-channel' }) RETURN e.archived AS archived`
  );
  assert.equal(ec[0].archived, false);

  const issue = await run(`MATCH (i:Issue { id: 'issue-1' }) RETURN i.isOpen AS isOpen`);
  assert.equal(issue[0].isOpen, false);
  assert.ok((await actionTypes()).includes("un-archive"));
});

test("unarchiveEvent requires an event id", async () => {
  await assert.rejects(
    env.resolvers.Mutation.unarchiveEvent(
      null,
      { eventId: "", channelUniqueName: "test-channel", explanation: "x" },
      ctx()
    ),
    /Event ID is required/i
  );
});

// --- unarchiveComment (resolves its channel from the comment) ---

test("unarchiveComment flips Comment.archived and closes the issue", async () => {
  await run(
    `CREATE (ch:Channel { uniqueName: 'test-channel', displayName: 'Test', createdAt: datetime() })
     CREATE (c:Comment { id: 'comment-1', text: 'bad', archived: true, isRootComment: true, createdAt: datetime() })
     CREATE (ch)-[:HAS_COMMENT]->(c)`
  );
  await seedIssue({ relatedCommentId: "comment-1" });

  await env.resolvers.Mutation.unarchiveComment(
    null,
    { commentId: "comment-1", explanation: "Reinstating" },
    ctx()
  );

  const c = await run(`MATCH (c:Comment { id: 'comment-1' }) RETURN c.archived AS archived`);
  assert.equal(c[0].archived, false);

  const issue = await run(`MATCH (i:Issue { id: 'issue-1' }) RETURN i.isOpen AS isOpen`);
  assert.equal(issue[0].isOpen, false);

  const types = await actionTypes();
  assert.ok(types.includes("un-archive"), `got ${JSON.stringify(types)}`);
  assert.ok(types.includes("close-issue"), `got ${JSON.stringify(types)}`);
});

test("unarchiveComment throws when the comment has no resolvable channel", async () => {
  await run(
    `CREATE (:Comment { id: 'comment-1', text: 'bad', archived: true, isRootComment: true, createdAt: datetime() })`
  );
  await assert.rejects(
    env.resolvers.Mutation.unarchiveComment(
      null,
      { commentId: "comment-1", explanation: "x" },
      ctx()
    ),
    /Could not find the forum name/i
  );
});
