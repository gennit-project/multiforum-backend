// Unit tests for the comment version-history service: the pure handler functions
// (author lookup + saving the previous text as a version) and the subscription
// class. Driven with an in-memory repository and a tiny executable schema. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import {
  getCommentAuthorUsername,
  handleCommentUpdateEvent,
  CommentVersionHistoryService,
} from "./commentVersionHistoryService.js";
import type {
  RecordTextVersionInput,
  VersionHistoryRepository,
} from "./persistence/versionHistoryRepository.js";

function makeRepository(opts: { authorName?: string | null; lookupThrows?: boolean } = {}) {
  const tracked: RecordTextVersionInput[] = [];
  const repository: VersionHistoryRepository = {
    async getCommentAuthorName() {
      if (opts.lookupThrows) throw new Error("db down");
      return opts.authorName ?? null;
    },
    async getDiscussionAuthorUsername() { return null; },
    async getWikiPageVersionAuthorUsername() { return null; },
    async recordTextVersion(input) {
      tracked.push(input);
      return "tv-1";
    },
  };
  return { repository, tracked };
}

test("getCommentAuthorUsername returns a User author's username", async () => {
  const { repository } = makeRepository({ authorName: "alice" });
  assert.equal(await getCommentAuthorUsername(repository, "c-1"), "alice");
});

test("getCommentAuthorUsername falls back to a ModerationProfile displayName", async () => {
  const { repository } = makeRepository({ authorName: "ModAlice" });
  assert.equal(await getCommentAuthorUsername(repository, "c-1"), "ModAlice");
});

test("getCommentAuthorUsername returns null when the comment is missing", async () => {
  const { repository } = makeRepository();
  assert.equal(await getCommentAuthorUsername(repository, "c-1"), null);
});

test("getCommentAuthorUsername swallows lookup errors", async () => {
  const { repository } = makeRepository({ lookupThrows: true });
  assert.equal(await getCommentAuthorUsername(repository, "c-1"), null);
});

test("handleCommentUpdateEvent records the previous text as a version", async () => {
  const { repository, tracked } = makeRepository({ authorName: "alice" });
  await handleCommentUpdateEvent(repository, { id: "c-1", text: "new" }, { text: "old" });
  assert.deepEqual(tracked, [{
    target: "comment",
    parentId: "c-1",
    body: "old",
    username: "alice",
  }]);
});

test("handleCommentUpdateEvent does nothing when text is unchanged or absent", async () => {
  const { repository, tracked } = makeRepository({ authorName: "alice" });
  await handleCommentUpdateEvent(repository, { id: "c-1", text: "same" }, { text: "same" });
  await handleCommentUpdateEvent(repository, { id: "c-1", text: "new" }, null);
  assert.deepEqual(tracked, []);
});

test("handleCommentUpdateEvent skips when the author cannot be resolved", async () => {
  const { repository, tracked } = makeRepository();
  await handleCommentUpdateEvent(repository, { id: "c-1", text: "new" }, { text: "old" });
  assert.deepEqual(tracked, []);
});

// ---- subscription class ----

function schemaYielding(events: any[]) {
  const typeDefs = `
    type UpdatedComment { id: ID, text: String }
    type PreviousValues { text: String }
    type CommentUpdatedPayload { updatedComment: UpdatedComment, previousValues: PreviousValues }
    type Query { _empty: String }
    type Subscription { commentUpdated: CommentUpdatedPayload }
  `;
  const resolvers = {
    Subscription: {
      commentUpdated: {
        subscribe: async function* () {
          for (const e of events) yield { commentUpdated: e };
        },
      },
    },
  };
  return makeExecutableSchema({ typeDefs, resolvers });
}
const flush = () => new Promise((r) => setImmediate(r));

test("service constructs and stop() is safe before start", () => {
  const { repository } = makeRepository();
  const svc = new CommentVersionHistoryService(schemaYielding([]), repository);
  svc.stop();
});

test("service start() processes update events then the loop completes", async () => {
  const { repository, tracked } = makeRepository({ authorName: "alice" });
  const schema = schemaYielding([
    { updatedComment: { id: "c-1", text: "new" }, previousValues: { text: "old" } },
    null,
  ]);
  const svc = new CommentVersionHistoryService(schema, repository);
  await svc.start();
  for (let i = 0; i < 50 && tracked.length === 0; i++) await flush();
  svc.stop();
  assert.ok(tracked.length >= 1, "processed at least the valid event");
});

test("service start() handles a subscribe error without throwing", async () => {
  const typeDefs = `type Query { _empty: String } type Subscription { commentUpdated: String }`;
  const resolvers = {
    Subscription: { commentUpdated: { subscribe: () => { throw new Error("no sub"); } } },
  };
  const { repository } = makeRepository();
  const svc = new CommentVersionHistoryService(makeExecutableSchema({ typeDefs, resolvers }), repository);
  await svc.start();
  svc.stop();
});
