import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  FIND_ALBUM_OWNERS_QUERY,
  FIND_COLLECTION_OWNERS_QUERY,
  FIND_COMMENT_AUTHOR_QUERY,
  FIND_DISCUSSION_AUTHOR_QUERY,
  FIND_EVENT_POSTER_QUERY,
  FIND_IMAGE_UPLOADER_QUERY,
  FIND_ISSUE_AUTHOR_QUERY,
  FIND_ISSUE_LOCK_QUERY,
  createContentAuthorizationRepository,
} from "./contentAuthorizationRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

test("content authorization reads are parameterized and leader-routed", async () => {
  const configs: unknown[] = [];
  const calls: Array<{ query: string; parameters: unknown }> = [];
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      configs.push(config);
      return {
        async run(query: string, parameters: unknown) {
          calls.push({ query, parameters });
          if (query === FIND_ALBUM_OWNERS_QUERY) {
            return { records: [record({ id: "album-1", username: "alice" })] };
          }
          if (query === FIND_COLLECTION_OWNERS_QUERY) {
            return { records: [record({ id: "collection-1", username: null })] };
          }
          if (query === FIND_COMMENT_AUTHOR_QUERY) {
            return { records: [record({ username: null, displayName: "Mod A" })] };
          }
          if (query === FIND_DISCUSSION_AUTHOR_QUERY) {
            return { records: [record({ username: "bob" })] };
          }
          if (query === FIND_EVENT_POSTER_QUERY) {
            return { records: [] };
          }
          if (query === FIND_IMAGE_UPLOADER_QUERY) {
            return { records: [record({ username: null })] };
          }
          if (query === FIND_ISSUE_AUTHOR_QUERY) {
            return { records: [record({ username: "carol", displayName: null })] };
          }
          return { records: [record({ locked: true })] };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createContentAuthorizationRepository(
    driver,
    "authorization-db"
  );

  assert.deepEqual(await repository.findAlbumOwners(["album-1"]), [
    { id: "album-1", username: "alice" },
  ]);
  assert.deepEqual(await repository.findCollectionOwners(["collection-1"]), [
    { id: "collection-1", username: null },
  ]);
  assert.deepEqual(await repository.findCommentAuthor("comment-1"), {
    found: true,
    actor: { username: null, displayName: "Mod A" },
  });
  assert.deepEqual(await repository.findDiscussionAuthor("discussion-1"), {
    found: true,
    username: "bob",
  });
  assert.deepEqual(await repository.findEventPoster("missing"), {
    found: false,
    username: null,
  });
  assert.deepEqual(await repository.findImageUploader("image-1"), {
    found: true,
    username: null,
  });
  assert.deepEqual(await repository.findIssueAuthor("issue-1"), {
    found: true,
    actor: { username: "carol", displayName: null },
  });
  assert.deepEqual(await repository.findIssueLock("issue-1"), {
    found: true,
    locked: true,
  });

  assert.deepEqual(
    configs,
    Array(8).fill({
      database: "authorization-db",
      defaultAccessMode: neo4j.session.WRITE,
    })
  );
  assert.deepEqual(calls, [
    { query: FIND_ALBUM_OWNERS_QUERY, parameters: { ids: ["album-1"] } },
    {
      query: FIND_COLLECTION_OWNERS_QUERY,
      parameters: { ids: ["collection-1"] },
    },
    { query: FIND_COMMENT_AUTHOR_QUERY, parameters: { id: "comment-1" } },
    {
      query: FIND_DISCUSSION_AUTHOR_QUERY,
      parameters: { id: "discussion-1" },
    },
    { query: FIND_EVENT_POSTER_QUERY, parameters: { id: "missing" } },
    { query: FIND_IMAGE_UPLOADER_QUERY, parameters: { id: "image-1" } },
    { query: FIND_ISSUE_AUTHOR_QUERY, parameters: { id: "issue-1" } },
    { query: FIND_ISSUE_LOCK_QUERY, parameters: { id: "issue-1" } },
  ]);
  assert.equal(closeCalls, 8);
});

test("owner list lookups skip empty inputs without opening a session", async () => {
  let sessionCalls = 0;
  const driver = {
    session() {
      sessionCalls += 1;
      throw new Error("should not open");
    },
  } as unknown as Driver;
  const repository = createContentAuthorizationRepository(driver);

  assert.deepEqual(await repository.findAlbumOwners([]), []);
  assert.deepEqual(await repository.findCollectionOwners([]), []);
  assert.equal(sessionCalls, 0);
});

test("author lookups distinguish missing content from content without an author", async () => {
  let runCalls = 0;
  const driver = {
    session() {
      return {
        async run() {
          runCalls += 1;
          return runCalls === 1
            ? { records: [] }
            : { records: [record({ username: null, displayName: null })] };
        },
        async close() {},
      };
    },
  } as unknown as Driver;
  const repository = createContentAuthorizationRepository(driver);

  assert.deepEqual(await repository.findIssueAuthor("missing"), {
    found: false,
    actor: null,
  });
  assert.deepEqual(await repository.findIssueAuthor("ownerless"), {
    found: true,
    actor: null,
  });
});

test("content authorization reads close sessions after query failures", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async run() {
          throw new Error("read failed");
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createContentAuthorizationRepository(driver);

  await assert.rejects(repository.findImageUploader("image-1"), /read failed/);
  assert.equal(closeCalls, 1);
});
