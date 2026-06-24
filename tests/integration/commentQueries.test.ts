// Integration tests for the comment query resolvers against live Neo4j:
// getCommentSection, getEventComments, getCommentReplies. Each runs a .cypher
// query to fetch comments. They call setUserDataOnContext but work anonymously
// (no auth token -> loggedInUsername null), so the context just supplies the
// driver/ogm and an empty request.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
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

const anon = () => ({
  driver: env.driver,
  ogm: env.ogm,
  req: { headers: {}, body: {} },
});

// --- getCommentSection ---

test("getCommentSection returns root comments for a discussion channel", async () => {
  await run(
    `CREATE (dc:DiscussionChannel { id: 'dc-1', discussionId: 'disc-1', channelUniqueName: 'test-channel', createdAt: datetime() })
     CREATE (u:User { username: 'alice' })
     CREATE (c:Comment { id: 'c1', text: 'a root comment', isRootComment: true, archived: false, createdAt: datetime() })
     CREATE (dc)-[:CONTAINS_COMMENT]->(c)
     CREATE (u)-[:AUTHORED_COMMENT]->(c)`
  );

  const result = await env.resolvers.Query.getCommentSection(
    null,
    { channelUniqueName: "test-channel", discussionId: "disc-1", modName: null, offset: "0", limit: "10", sort: "new" },
    anon()
  );

  assert.ok(result.DiscussionChannel, "DiscussionChannel should be returned");
  assert.equal(result.Comments.length, 1);
  assert.equal(result.Comments[0].id, "c1");
  assert.equal(result.Comments[0].text, "a root comment");
});

test("getCommentSection returns empty when the discussion channel is missing", async () => {
  const result = await env.resolvers.Query.getCommentSection(
    null,
    { channelUniqueName: "test-channel", discussionId: "nope", offset: "0", limit: "10", sort: "new" },
    anon()
  );
  assert.equal(result.DiscussionChannel, null);
  assert.deepEqual(result.Comments, []);
});

// --- getEventComments ---

test("getEventComments returns root comments for an event", async () => {
  await run(
    `CREATE (e:Event { id: 'event-1', title: 'Test Event', startTime: datetime(), endTime: datetime(), canceled: false, createdAt: datetime() })
     CREATE (c:Comment { id: 'ec1', text: 'great event', isRootComment: true, archived: false, createdAt: datetime() })
     CREATE (e)-[:HAS_COMMENT]->(c)`
  );

  const result = await env.resolvers.Query.getEventComments(
    null,
    { eventId: "event-1", offset: "0", limit: "10", sort: "new" },
    anon()
  );

  assert.ok(result.Event, "Event should be returned");
  assert.equal(result.Event.id, "event-1");
  assert.equal(result.Comments.length, 1);
  assert.equal(result.Comments[0].id, "ec1");
});

// --- getCommentReplies ---

test("getCommentReplies returns child comments of a parent comment", async () => {
  await run(
    `CREATE (p:Comment { id: 'parent-1', text: 'parent', isRootComment: true, archived: false, createdAt: datetime() })
     CREATE (r:Comment { id: 'reply-1', text: 'a reply', isRootComment: false, archived: false, createdAt: datetime() })
     CREATE (r)-[:IS_REPLY_TO]->(p)`
  );

  const result = await env.resolvers.Query.getCommentReplies(
    null,
    { commentId: "parent-1", modName: null, offset: "0", limit: "10", sort: "new" },
    anon()
  );

  assert.equal(result.ChildComments.length, 1);
  assert.equal(result.ChildComments[0].id, "reply-1");
  assert.equal(result.ChildComments[0].ParentComment.id, "parent-1");
  assert.ok(Number(result.aggregateChildCommentCount) >= 1);
});

test("getCommentReplies returns no replies for a comment with none", async () => {
  await run(
    `CREATE (:Comment { id: 'lonely', text: 'no replies', isRootComment: true, archived: false, createdAt: datetime() })`
  );
  const result = await env.resolvers.Query.getCommentReplies(
    null,
    { commentId: "lonely", modName: null, offset: "0", limit: "10", sort: "new" },
    anon()
  );
  assert.equal(result.ChildComments.length, 0);
});
