import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  GET_COMMENT_AUTHOR_NAME_QUERY,
  GET_DISCUSSION_AUTHOR_USERNAME_QUERY,
  GET_WIKI_PAGE_VERSION_AUTHOR_USERNAME_QUERY,
  RECORD_TEXT_VERSION_QUERIES,
  createVersionHistoryRepository,
  type RecordTextVersionInput,
} from "./versionHistoryRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

test("author lookups are parameterized, leader-routed, and close their sessions", async () => {
  const sessionConfigs: unknown[] = [];
  const calls: Array<{ query: string; parameters: unknown }> = [];
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      sessionConfigs.push(config);
      return {
        async run(query: string, parameters: unknown) {
          calls.push({ query, parameters });
          if (query === GET_COMMENT_AUTHOR_NAME_QUERY) {
            return { records: [record({ username: "Mod Alice" })] };
          }
          if (query === GET_DISCUSSION_AUTHOR_USERNAME_QUERY) {
            return { records: [record({ username: "alice" })] };
          }
          return { records: [record({ username: "wiki-editor" })] };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createVersionHistoryRepository(driver, "history-db");

  assert.equal(await repository.getCommentAuthorName("comment-1"), "Mod Alice");
  assert.equal(
    await repository.getDiscussionAuthorUsername("discussion-1"),
    "alice"
  );
  assert.equal(
    await repository.getWikiPageVersionAuthorUsername("wiki-1"),
    "wiki-editor"
  );

  assert.deepEqual(sessionConfigs, Array(3).fill({
    database: "history-db",
    defaultAccessMode: neo4j.session.WRITE,
  }));
  assert.deepEqual(calls, [
    {
      query: GET_COMMENT_AUTHOR_NAME_QUERY,
      parameters: { commentId: "comment-1" },
    },
    {
      query: GET_DISCUSSION_AUTHOR_USERNAME_QUERY,
      parameters: { discussionId: "discussion-1" },
    },
    {
      query: GET_WIKI_PAGE_VERSION_AUTHOR_USERNAME_QUERY,
      parameters: { wikiPageId: "wiki-1" },
    },
  ]);
  assert.equal(closeCalls, 3);
});

test("recordTextVersion maps every target to its static relationship query", async () => {
  const sessionConfigs: unknown[] = [];
  const calls: Array<{ query: string; parameters: unknown }> = [];
  let executeWriteCalls = 0;
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      sessionConfigs.push(config);
      return {
        async executeWrite(
          work: (transaction: { run(query: string, parameters: unknown): Promise<unknown> }) => Promise<unknown>
        ) {
          executeWriteCalls += 1;
          return work({
            async run(query: string, parameters: unknown) {
              calls.push({ query, parameters });
              return { records: [record({ id: `version-${calls.length}` })] };
            },
          });
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createVersionHistoryRepository(driver, "history-db");
  const inputs: RecordTextVersionInput[] = [
    {
      target: "comment",
      parentId: "comment-1",
      body: "old text",
      username: "alice",
    },
    {
      target: "discussion-title",
      parentId: "discussion-1",
      body: "new title",
      username: "alice",
    },
    {
      target: "discussion-body",
      parentId: "discussion-1",
      body: "new body",
      username: "alice",
    },
    {
      target: "wiki-page",
      parentId: "wiki-1",
      body: "new wiki body",
      username: "alice",
      editReason: "cleanup",
    },
  ];

  const ids = await Promise.all(inputs.map((input) => repository.recordTextVersion(input)));

  assert.deepEqual(ids, ["version-1", "version-2", "version-3", "version-4"]);
  assert.deepEqual(
    calls.map(({ query }) => query),
    inputs.map(({ target }) => RECORD_TEXT_VERSION_QUERIES[target])
  );
  assert.deepEqual(calls[0]?.parameters, {
    parentId: "comment-1",
    body: "old text",
    username: "alice",
    editReason: null,
  });
  assert.deepEqual(calls[3]?.parameters, {
    parentId: "wiki-1",
    body: "new wiki body",
    username: "alice",
    editReason: "cleanup",
  });
  assert.ok(sessionConfigs.every((config) =>
    (config as { database: string }).database === "history-db"
  ));
  assert.equal(executeWriteCalls, 4);
  assert.equal(closeCalls, 4);
});

test("recordTextVersion returns null when the parent or author does not match", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async executeWrite(work: (transaction: unknown) => Promise<unknown>) {
          return work({ async run() { return { records: [] }; } });
        },
        async close() { closeCalls += 1; },
      };
    },
  } as unknown as Driver;

  const result = await createVersionHistoryRepository(driver).recordTextVersion({
    target: "comment",
    parentId: "missing",
    body: "orphan",
    username: "missing",
  });

  assert.equal(result, null);
  assert.equal(closeCalls, 1);
});

test("recordTextVersion skips empty bodies and usernames before opening a session", async () => {
  let sessionCalls = 0;
  const driver = {
    session() {
      sessionCalls += 1;
      throw new Error("should not open");
    },
  } as unknown as Driver;
  const repository = createVersionHistoryRepository(driver);

  assert.equal(await repository.recordTextVersion({
    target: "comment",
    parentId: "comment-1",
    body: "",
    username: "alice",
  }), null);
  assert.equal(await repository.recordTextVersion({
    target: "comment",
    parentId: "comment-1",
    body: "text",
    username: "",
  }), null);
  assert.equal(sessionCalls, 0);
});

test("recordTextVersion closes the session when the transaction fails", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async executeWrite(work: (transaction: unknown) => Promise<unknown>) {
          return work({ async run() { throw new Error("write failed"); } });
        },
        async close() { closeCalls += 1; },
      };
    },
  } as unknown as Driver;
  const repository = createVersionHistoryRepository(driver);

  await assert.rejects(repository.recordTextVersion({
    target: "wiki-page",
    parentId: "wiki-1",
    body: "text",
    username: "alice",
  }), /write failed/);
  assert.equal(closeCalls, 1);
});
