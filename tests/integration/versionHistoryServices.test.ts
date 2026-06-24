// Integration tests for the version-history services' callable handlers,
// extracted from the subscription machinery so they can be exercised directly
// against a live Neo4j container. Covers discussion, comment (newly completed),
// and wikiPage version tracking plus the shared TextVersion helper.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleDiscussionUpdateEvent } from "../../services/discussionVersionHistoryService.js";
import { handleCommentUpdateEvent } from "../../services/commentVersionHistoryService.js";
import { handleWikiPageUpdateEvent } from "../../services/wikiPageVersionHistoryService.js";
import { createAuthoredTextVersion } from "../../services/textVersionHistory.js";
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

// --- Discussion version history ---

test("handleDiscussionUpdateEvent records title and body versions authored by the discussion author", async () => {
  await run(
    `CREATE (alice:User { username: 'alice' })
     CREATE (d:Discussion { id: 'd1', title: 'New Title', body: 'New body', createdAt: datetime() })
     CREATE (alice)-[:POSTED_DISCUSSION]->(d)`
  );

  await handleDiscussionUpdateEvent(
    env.ogm,
    { id: "d1", title: "New Title", body: "New body" },
    { title: "Old Title", body: "Old body" }
  );

  const titleV = await run(
    `MATCH (:Discussion { id: 'd1' })-[:HAS_TITLE_VERSION]->(tv:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
     RETURN tv.body AS body, u.username AS author`
  );
  assert.equal(titleV.length, 1, "a title version should be recorded");
  assert.equal(titleV[0].body, "New Title");
  assert.equal(titleV[0].author, "alice");

  const bodyV = await run(
    `MATCH (:Discussion { id: 'd1' })-[:HAS_BODY_VERSION]->(tv:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
     RETURN tv.body AS body, u.username AS author`
  );
  assert.equal(bodyV.length, 1, "a body version should be recorded");
  assert.equal(bodyV[0].body, "New body");
  assert.equal(bodyV[0].author, "alice");
});

test("handleDiscussionUpdateEvent records nothing when title and body are unchanged", async () => {
  await run(
    `CREATE (alice:User { username: 'alice' })
     CREATE (d:Discussion { id: 'd1', title: 'Same', body: 'Same body', createdAt: datetime() })
     CREATE (alice)-[:POSTED_DISCUSSION]->(d)`
  );

  await handleDiscussionUpdateEvent(
    env.ogm,
    { id: "d1", title: "Same", body: "Same body" },
    { title: "Same", body: "Same body" }
  );

  const versions = await run(`MATCH (tv:TextVersion) RETURN count(tv) AS n`);
  assert.equal(Number(versions[0].n), 0, "no version should be recorded for an unchanged update");
});

test("handleDiscussionUpdateEvent skips tracking when the discussion has no author", async () => {
  await run(`CREATE (:Discussion { id: 'd1', title: 'New Title', body: 'New body', createdAt: datetime() })`);

  await handleDiscussionUpdateEvent(
    env.ogm,
    { id: "d1", title: "New Title", body: "New body" },
    { title: "Old Title", body: "Old body" }
  );

  const versions = await run(`MATCH (tv:TextVersion) RETURN count(tv) AS n`);
  assert.equal(Number(versions[0].n), 0, "no version when the author cannot be resolved");
});

// --- Comment version history (newly completed: previously never tracked) ---

test("handleCommentUpdateEvent saves the previous text as a version authored by the comment author", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (c:Comment { id: 'c1', text: 'New text', isRootComment: true, createdAt: datetime() })
     CREATE (bob)-[:AUTHORED_COMMENT]->(c)`
  );

  await handleCommentUpdateEvent(
    env.ogm,
    { id: "c1", text: "New text" },
    { text: "Old text" }
  );

  const versions = await run(
    `MATCH (:Comment { id: 'c1' })-[:HAS_VERSION]->(tv:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
     RETURN tv.body AS body, u.username AS author`
  );
  assert.equal(versions.length, 1, "a version with the previous text should be recorded");
  assert.equal(versions[0].body, "Old text", "the PREVIOUS text is preserved as history");
  assert.equal(versions[0].author, "bob");
});

test("handleCommentUpdateEvent records nothing when text is unchanged", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (c:Comment { id: 'c1', text: 'Same', isRootComment: true, createdAt: datetime() })
     CREATE (bob)-[:AUTHORED_COMMENT]->(c)`
  );

  await handleCommentUpdateEvent(env.ogm, { id: "c1", text: "Same" }, { text: "Same" });

  const versions = await run(`MATCH (tv:TextVersion) RETURN count(tv) AS n`);
  assert.equal(Number(versions[0].n), 0);
});

// --- WikiPage version history ---

test("handleWikiPageUpdateEvent records title and body versions (with edit reason) for the version author", async () => {
  await run(
    `CREATE (carol:User { username: 'carol' })
     CREATE (w:WikiPage { id: 'w1', title: 'New Title', body: 'New body', slug: 'page', createdAt: datetime() })
     CREATE (carol)-[:AUTHORED_VERSION]->(w)`
  );

  await handleWikiPageUpdateEvent(
    env.ogm,
    { id: "w1", title: "New Title", body: "New body", editReason: "fixed typo" },
    { title: "Old Title", body: "Old body" }
  );

  const versions = await run(
    `MATCH (:WikiPage { id: 'w1' })-[:HAS_VERSION]->(tv:TextVersion)<-[:AUTHORED_VERSION]-(u:User)
     RETURN tv.body AS body, tv.editReason AS editReason, u.username AS author ORDER BY tv.body`
  );
  assert.equal(versions.length, 2, "title and body versions should both be recorded");
  assert.deepEqual(
    versions.map((v: any) => v.body).sort(),
    ["New Title", "New body"].sort()
  );
  for (const v of versions) {
    assert.equal(v.author, "carol");
    assert.equal(v.editReason, "fixed typo");
  }
});

// --- Shared helper ---

test("createAuthoredTextVersion returns null when the author user does not exist", async () => {
  const id = await createAuthoredTextVersion(env.ogm, {
    body: "orphan",
    username: "nobody",
  });
  assert.equal(id, null);

  const versions = await run(`MATCH (tv:TextVersion) RETURN count(tv) AS n`);
  assert.equal(Number(versions[0].n), 0, "no TextVersion should be created for a missing user");
});

test("createAuthoredTextVersion returns null for empty body", async () => {
  await run(`CREATE (:User { username: 'dave' })`);
  const id = await createAuthoredTextVersion(env.ogm, { body: "", username: "dave" });
  assert.equal(id, null);
});
