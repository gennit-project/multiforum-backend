// Integration tests for the wired-up mutation-side hooks (invoked from the
// update/archival mutation middleware, distinct from the subscription
// services): the version-history handlers, which capture the pre-edit content
// as a TextVersion and notify the original author when a different user edits
// it, and the archived-content notification hook. The existing unit tests mock
// the OGM; these run the real createInAppNotification write against a live
// Neo4j container.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { GraphQLContext } from "../../types/context.js";
import { commentVersionHistoryHandler } from "../../hooks/commentVersionHistoryHook.js";
import {
  discussionVersionHistoryHandler,
  discussionEditNotificationHandler,
} from "../../hooks/discussionVersionHistoryHook.js";
import {
  eventVersionHistoryHandler,
  eventEditNotificationHandler,
} from "../../hooks/eventVersionHistoryHook.js";
import { wikiPageVersionHistoryHandler } from "../../hooks/wikiPageVersionHistoryHook.js";
import { notifyArchivedContentAuthor } from "../../hooks/archivedContentNotificationHook.js";
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

// context shaped like the mutation middleware builds: ogm + driver + the
// authenticated editor on context.user.
const editorCtx = (username: string) =>
  ({
    ogm: env.ogm,
    driver: env.driver,
    user: { username },
  }) as unknown as GraphQLContext;

const notificationsFor = (username: string) =>
  run(
    `MATCH (:User { username: $username })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.text AS text`,
    { username }
  );

// --- comment version history hook ---

test("commentVersionHistoryHandler saves the pre-edit text and notifies the author when a moderator edits", async () => {
  await run(
    `CREATE (alice:User { username: 'alice', createdAt: datetime() })
     CREATE (mod:User { username: 'mod', createdAt: datetime() })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (c:Comment { id: 'c1', text: 'old text', isRootComment: true, createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:CONTAINS_COMMENT]->(c)
     CREATE (alice)-[:AUTHORED_COMMENT]->(c)`
  );

  await commentVersionHistoryHandler({
    context: editorCtx("mod"),
    params: { where: { id: "c1" }, update: { text: "new text" } },
  });

  const versions = await run(
    `MATCH (:Comment { id: 'c1' })-[:HAS_VERSION]->(tv:TextVersion) RETURN tv.body AS body`
  );
  assert.equal(versions.length, 1, "the pre-edit text should be saved as a version");
  assert.equal(versions[0].body, "old text");

  const edited = await run(
    `MATCH (c:Comment { id: 'c1' }) RETURN c.textLastEdited AS t`
  );
  assert.ok(edited[0].t, "textLastEdited should be set");

  const notifs = await notificationsFor("alice");
  assert.equal(notifs.length, 1, "the comment author should be notified of the edit");
  assert.match(notifs[0].text, /edited your comment/i);
});

test("commentVersionHistoryHandler is a no-op when text is unchanged", async () => {
  await run(
    `CREATE (alice:User { username: 'alice', createdAt: datetime() })
     CREATE (c:Comment { id: 'c1', text: 'same', isRootComment: true, createdAt: datetime() })
     CREATE (alice)-[:AUTHORED_COMMENT]->(c)`
  );

  await commentVersionHistoryHandler({
    context: editorCtx("alice"),
    params: { where: { id: "c1" }, update: { text: "same" } },
  });

  const versions = await run(`MATCH (tv:TextVersion) RETURN count(tv) AS n`);
  assert.equal(Number(versions[0].n), 0);
});

// --- discussion version history hook ---

test("discussionVersionHistoryHandler saves pre-edit title and body versions and updates BodyLastEditedBy", async () => {
  await run(
    `CREATE (alice:User { username: 'alice', createdAt: datetime() })
     CREATE (mod:User { username: 'mod', createdAt: datetime() })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'Old Title', body: 'Old body', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (alice)-[:POSTED_DISCUSSION]->(d)`
  );

  await discussionVersionHistoryHandler({
    context: editorCtx("mod"),
    params: { where: { id: "d1" }, update: { title: "New Title", body: "New body" } },
  });

  const titleV = await run(
    `MATCH (:Discussion { id: 'd1' })-[:HAS_TITLE_VERSION]->(tv:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
     RETURN tv.body AS body, u.username AS author`
  );
  assert.equal(titleV.length, 1);
  assert.equal(titleV[0].body, "Old Title");
  assert.equal(titleV[0].author, "mod", "title revision is attributed to the editor");

  const bodyV = await run(
    `MATCH (:Discussion { id: 'd1' })-[:HAS_BODY_VERSION]->(tv:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
     RETURN tv.body AS body, u.username AS author`
  );
  assert.equal(bodyV.length, 1);
  assert.equal(bodyV[0].body, "Old body");
  assert.equal(bodyV[0].author, "alice", "body revision is attributed to the content author");

  const lastEdited = await run(
    `MATCH (:Discussion { id: 'd1' })-[:BODY_LAST_EDITED_BY]->(u:User) RETURN u.username AS username`
  );
  assert.equal(lastEdited.length, 1);
  assert.equal(lastEdited[0].username, "mod");
});

test("discussionEditNotificationHandler notifies the discussion author of a moderator edit", async () => {
  await run(`CREATE (:User { username: 'alice', createdAt: datetime() })`);

  await discussionEditNotificationHandler({
    context: editorCtx("mod"),
    params: { where: { id: "d1" }, update: { title: "New Title" } },
    discussionSnapshot: {
      Author: { username: "alice" },
      DiscussionChannels: [{ channelUniqueName: "cats" }],
      title: "Old Title",
    },
  });

  const notifs = await notificationsFor("alice");
  assert.equal(notifs.length, 1);
  assert.match(notifs[0].text, /edited your discussion/i);
});

test("discussionEditNotificationHandler does not notify when the author edits their own discussion", async () => {
  await run(`CREATE (:User { username: 'alice', createdAt: datetime() })`);

  await discussionEditNotificationHandler({
    context: editorCtx("alice"),
    params: { where: { id: "d1" }, update: { title: "New Title" } },
    discussionSnapshot: {
      Author: { username: "alice" },
      DiscussionChannels: [{ channelUniqueName: "cats" }],
      title: "Old Title",
    },
  });

  assert.equal((await notificationsFor("alice")).length, 0);
});

// --- event version history hook ---

const seedEvent = () =>
  run(
    `CREATE (alice:User { username: 'alice', createdAt: datetime() })
     CREATE (mod:User { username: 'mod', createdAt: datetime() })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (e:Event { id: 'e1', title: 'Old Title', description: 'Old description', createdAt: datetime() })
     CREATE (ec:EventChannel { id: 'ec1', eventId: 'e1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (ec)-[:POSTED_IN_CHANNEL]->(e)
     CREATE (alice)-[:POSTED_BY]->(e)`
  );

test("eventVersionHistoryHandler saves pre-edit title and description versions and updates DescriptionLastEditedBy", async () => {
  await seedEvent();

  await eventVersionHistoryHandler({
    context: editorCtx("mod"),
    params: {
      where: { id: "e1" },
      update: { title: "New Title", description: "New description" },
    },
  });

  const titleV = await run(
    `MATCH (:Event { id: 'e1' })-[:HAS_TITLE_VERSION]->(tv:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
     RETURN tv.body AS body, u.username AS author`
  );
  assert.equal(titleV.length, 1);
  assert.equal(titleV[0].body, "Old Title");
  assert.equal(titleV[0].author, "mod", "title revision is attributed to the editor");

  const descV = await run(
    `MATCH (:Event { id: 'e1' })-[:HAS_DESCRIPTION_VERSION]->(tv:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
     RETURN tv.body AS body, u.username AS author`
  );
  assert.equal(descV.length, 1);
  assert.equal(descV[0].body, "Old description");
  assert.equal(descV[0].author, "alice", "description revision is attributed to the content author");

  const lastEdited = await run(
    `MATCH (:Event { id: 'e1' })-[:DESCRIPTION_LAST_EDITED_BY]->(u:User) RETURN u.username AS username`
  );
  assert.equal(lastEdited.length, 1);
  assert.equal(lastEdited[0].username, "mod");
});

test("eventVersionHistoryHandler saves only a title version when only the title changes", async () => {
  await seedEvent();

  await eventVersionHistoryHandler({
    context: editorCtx("mod"),
    params: {
      where: { id: "e1" },
      update: { title: "New Title", description: "Old description" },
    },
  });

  const versions = await run(
    `MATCH (:Event { id: 'e1' })-[r]->(tv:TextVersion)
     RETURN type(r) AS rel, tv.body AS body`
  );
  assert.deepEqual(
    versions.map((v: any) => ({ rel: v.rel, body: v.body })),
    [{ rel: "HAS_TITLE_VERSION", body: "Old Title" }]
  );
});

test("eventVersionHistoryHandler saves only a description version when only the description changes", async () => {
  await seedEvent();

  await eventVersionHistoryHandler({
    context: editorCtx("mod"),
    params: {
      where: { id: "e1" },
      update: { title: "Old Title", description: "New description" },
    },
  });

  const versions = await run(
    `MATCH (:Event { id: 'e1' })-[r]->(tv:TextVersion)
     RETURN type(r) AS rel, tv.body AS body`
  );
  assert.deepEqual(
    versions.map((v: any) => ({ rel: v.rel, body: v.body })),
    [{ rel: "HAS_DESCRIPTION_VERSION", body: "Old description" }]
  );
});

test("eventVersionHistoryHandler is a no-op when title and description are unchanged", async () => {
  await seedEvent();

  await eventVersionHistoryHandler({
    context: editorCtx("alice"),
    params: {
      where: { id: "e1" },
      update: { title: "Old Title", description: "Old description" },
    },
  });

  const versions = await run(`MATCH (tv:TextVersion) RETURN count(tv) AS n`);
  assert.equal(Number(versions[0].n), 0);
});

test("eventEditNotificationHandler notifies the event author of a moderator edit", async () => {
  await run(`CREATE (:User { username: 'alice', createdAt: datetime() })`);

  await eventEditNotificationHandler({
    context: editorCtx("mod"),
    params: { where: { id: "e1" }, update: { title: "New Title" } },
    eventSnapshot: {
      Poster: { username: "alice" },
      EventChannels: [{ channelUniqueName: "cats" }],
      title: "Old Title",
    },
  });

  const notifs = await notificationsFor("alice");
  assert.equal(notifs.length, 1);
  assert.match(notifs[0].text, /edited your event/i);
});

test("eventEditNotificationHandler does not notify when the author edits their own event", async () => {
  await run(`CREATE (:User { username: 'alice', createdAt: datetime() })`);

  await eventEditNotificationHandler({
    context: editorCtx("alice"),
    params: { where: { id: "e1" }, update: { title: "New Title" } },
    eventSnapshot: {
      Poster: { username: "alice" },
      EventChannels: [{ channelUniqueName: "cats" }],
      title: "Old Title",
    },
  });

  assert.equal((await notificationsFor("alice")).length, 0);
});

// --- wikiPage version history hook ---

test("wikiPageVersionHistoryHandler saves pre-edit title and body versions with the edit reason", async () => {
  await run(
    `CREATE (alice:User { username: 'alice', createdAt: datetime() })
     CREATE (w:WikiPage { id: 'w1', title: 'Old Title', body: 'Old body', editReason: 'cleanup', slug: 'page', createdAt: datetime() })
     CREATE (alice)-[:AUTHORED_VERSION]->(w)`
  );

  await wikiPageVersionHistoryHandler({
    context: { ogm: env.ogm, driver: env.driver },
    params: { where: { id: "w1" }, update: { title: "New Title", body: "New body" } },
  });

  const versions = await run(
    `MATCH (:WikiPage { id: 'w1' })-[:HAS_VERSION]->(tv:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
     RETURN tv.body AS body, tv.editReason AS editReason, u.username AS author`
  );
  assert.equal(versions.length, 2, "both pre-edit title and body should be saved");
  assert.deepEqual(
    versions.map((v: any) => v.body).sort(),
    ["Old Title", "Old body"].sort()
  );
  for (const v of versions) {
    assert.equal(v.author, "alice");
    assert.equal(v.editReason, "cleanup");
  }
});

// --- archived-content notification hook ---

test("notifyArchivedContentAuthor writes a moderation notification to the content author", async () => {
  await run(`CREATE (:User { username: 'alice', createdAt: datetime() })`);

  const sent = await notifyArchivedContentAuthor({
    context: { ogm: env.ogm, driver: env.driver },
    contentType: "comment",
    authorUsername: "alice",
    contentUrl: "https://example.test/forums/cats/discussions/d1/comments/c1",
    channelUniqueName: "cats",
    issueNumber: 7,
    moderatorUsername: "mod",
  });

  assert.equal(sent, true, "the hook should report the notification was created");

  const notifs = await run(
    `MATCH (:User { username: 'alice' })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.text AS text, n.notificationType AS type`
  );
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].type, "moderation");
  assert.match(notifs[0].text, /was archived/i);
});

test("notifyArchivedContentAuthor does not notify on self-archival", async () => {
  await run(`CREATE (:User { username: 'alice', createdAt: datetime() })`);

  const sent = await notifyArchivedContentAuthor({
    context: { ogm: env.ogm, driver: env.driver },
    contentType: "comment",
    authorUsername: "alice",
    contentUrl: "https://example.test/x",
    channelUniqueName: "cats",
    issueNumber: 7,
    moderatorUsername: "alice",
  });

  assert.equal(sent, false);
  assert.equal((await notificationsFor("alice")).length, 0);
});
