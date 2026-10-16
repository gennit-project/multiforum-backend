import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createContentAuthorizationRepository } from "../../services/persistence/contentAuthorizationRepository.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = await startNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);
});

after(async () => {
  await stopNeo4j();
});

test("loads album and collection owners while retaining ownerless entities", async () => {
  await driver.executeQuery(`
    CREATE (alice:User {username: "alice"})
    CREATE (album:Album {id: "album-1"})
    CREATE (ownerlessAlbum:Album {id: "album-ownerless"})
    CREATE (collection:Collection {id: "collection-1"})
    CREATE (alice)-[:HAS_ALBUM]->(album)
    CREATE (collection)-[:CREATED_BY]->(alice)
  `);
  const repository = createContentAuthorizationRepository(driver, "neo4j");

  assert.deepEqual(
    new Set(
      (await repository.findAlbumOwners([
        "album-1",
        "album-ownerless",
        "missing",
      ])).map((item) => JSON.stringify(item))
    ),
    new Set([
      JSON.stringify({ id: "album-1", username: "alice" }),
      JSON.stringify({ id: "album-ownerless", username: null }),
    ])
  );
  assert.deepEqual(await repository.findCollectionOwners(["collection-1"]), [
    { id: "collection-1", username: "alice" },
  ]);
});

test("loads user and moderation-profile authors", async () => {
  await driver.executeQuery(`
    CREATE (alice:User {username: "alice"})
    CREATE (moderator:ModerationProfile {displayName: "Mod A"})
    CREATE (userComment:Comment {id: "comment-user"})
    CREATE (modComment:Comment {id: "comment-mod"})
    CREATE (ownerlessComment:Comment {id: "comment-ownerless"})
    CREATE (userIssue:Issue {id: "issue-user"})
    CREATE (modIssue:Issue {id: "issue-mod"})
    CREATE (alice)-[:AUTHORED_COMMENT]->(userComment)
    CREATE (moderator)-[:AUTHORED_COMMENT]->(modComment)
    CREATE (userIssue)-[:AUTHORED_ISSUE]->(alice)
    CREATE (modIssue)-[:AUTHORED_ISSUE]->(moderator)
  `);
  const repository = createContentAuthorizationRepository(driver, "neo4j");

  assert.deepEqual(await repository.findCommentAuthor("comment-user"), {
    found: true,
    actor: { username: "alice", displayName: null },
  });
  assert.deepEqual(await repository.findCommentAuthor("comment-mod"), {
    found: true,
    actor: { username: null, displayName: "Mod A" },
  });
  assert.deepEqual(await repository.findCommentAuthor("comment-ownerless"), {
    found: true,
    actor: null,
  });
  assert.deepEqual(await repository.findIssueAuthor("issue-user"), {
    found: true,
    actor: { username: "alice", displayName: null },
  });
  assert.deepEqual(await repository.findIssueAuthor("issue-mod"), {
    found: true,
    actor: { username: null, displayName: "Mod A" },
  });
  assert.deepEqual(await repository.findIssueAuthor("missing"), {
    found: false,
    actor: null,
  });
});

test("loads discussion, event, and image user ownership", async () => {
  await driver.executeQuery(`
    CREATE (alice:User {username: "alice"})
    CREATE (discussion:Discussion {id: "discussion-1"})
    CREATE (event:Event {id: "event-1"})
    CREATE (image:Image {id: "image-1"})
    CREATE (ownerlessImage:Image {id: "image-ownerless"})
    CREATE (alice)-[:POSTED_DISCUSSION]->(discussion)
    CREATE (alice)-[:POSTED_BY]->(event)
    CREATE (alice)-[:UPLOADED_IMAGE]->(image)
  `);
  const repository = createContentAuthorizationRepository(driver, "neo4j");

  assert.deepEqual(await repository.findDiscussionAuthor("discussion-1"), {
    found: true,
    username: "alice",
  });
  assert.deepEqual(await repository.findEventPoster("event-1"), {
    found: true,
    username: "alice",
  });
  assert.deepEqual(await repository.findImageUploader("image-1"), {
    found: true,
    username: "alice",
  });
  assert.deepEqual(await repository.findImageUploader("image-ownerless"), {
    found: true,
    username: null,
  });
  assert.deepEqual(await repository.findDiscussionAuthor("missing"), {
    found: false,
    username: null,
  });
});

test("distinguishes locked, unlocked, null, and missing issues", async () => {
  await driver.executeQuery(`
    CREATE (:Issue {id: "locked", locked: true})
    CREATE (:Issue {id: "unlocked", locked: false})
    CREATE (:Issue {id: "legacy"})
  `);
  const repository = createContentAuthorizationRepository(driver, "neo4j");

  assert.deepEqual(await repository.findIssueLock("locked"), {
    found: true,
    locked: true,
  });
  assert.deepEqual(await repository.findIssueLock("unlocked"), {
    found: true,
    locked: false,
  });
  assert.deepEqual(await repository.findIssueLock("legacy"), {
    found: true,
    locked: null,
  });
  assert.deepEqual(await repository.findIssueLock("missing"), {
    found: false,
    locked: null,
  });
});
