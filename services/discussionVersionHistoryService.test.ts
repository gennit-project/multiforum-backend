// Unit tests for the discussion version-history service: the pure handler
// functions (author lookup + per-field version tracking) and the subscription
// class (start/process/stop). Driven with an in-memory repository and a tiny
// executable schema whose subscription yields controlled events. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import {
  getDiscussionAuthorUsername,
  handleDiscussionUpdateEvent,
  DiscussionVersionHistoryService,
} from "./discussionVersionHistoryService.js";
import type {
  RecordTextVersionInput,
  VersionHistoryRepository,
} from "./persistence/versionHistoryRepository.js";

function makeRepository(opts: { username?: string | null; lookupThrows?: boolean } = {}) {
  const tracked: RecordTextVersionInput[] = [];
  const repository: VersionHistoryRepository = {
    async getCommentAuthorName() { return null; },
    async getDiscussionAuthorUsername() {
      if (opts.lookupThrows) throw new Error("db down");
      return opts.username ?? null;
    },
    async getWikiPageVersionAuthorUsername() { return null; },
    async recordTextVersion(input) {
      tracked.push(input);
      return "tv-1";
    },
  };
  return { repository, tracked };
}

test("getDiscussionAuthorUsername returns the author's username", async () => {
  const { repository } = makeRepository({ username: "alice" });
  assert.equal(await getDiscussionAuthorUsername(repository, "d-1"), "alice");
});

test("getDiscussionAuthorUsername returns null when the discussion is missing", async () => {
  const { repository } = makeRepository();
  assert.equal(await getDiscussionAuthorUsername(repository, "d-1"), null);
});

test("getDiscussionAuthorUsername swallows lookup errors and returns null", async () => {
  const { repository } = makeRepository({ lookupThrows: true });
  assert.equal(await getDiscussionAuthorUsername(repository, "d-1"), null);
});

test("handleDiscussionUpdateEvent skips everything when the author is unknown", async () => {
  const { repository, tracked } = makeRepository();
  await handleDiscussionUpdateEvent(repository, { id: "d-1", title: "new" }, { title: "old" });
  assert.deepEqual(tracked, []);
});

test("handleDiscussionUpdateEvent tracks a title change only", async () => {
  const { repository, tracked } = makeRepository({ username: "alice" });
  await handleDiscussionUpdateEvent(
    repository,
    { id: "d-1", title: "new title", body: "same" },
    { title: "old title", body: "same" }
  );
  assert.deepEqual(tracked, [{
    target: "discussion-title",
    parentId: "d-1",
    body: "new title",
    username: "alice",
  }]);
});

test("handleDiscussionUpdateEvent tracks both title and body when both change", async () => {
  const { repository, tracked } = makeRepository({ username: "alice" });
  await handleDiscussionUpdateEvent(
    repository,
    { id: "d-1", title: "new title", body: "new body" },
    { title: "old title", body: "old body" }
  );
  assert.deepEqual(tracked.map(({ target }) => target), [
    "discussion-title",
    "discussion-body",
  ]);
});

test("handleDiscussionUpdateEvent tracks nothing when values are unchanged or absent", async () => {
  const { repository, tracked } = makeRepository({ username: "alice" });
  await handleDiscussionUpdateEvent(repository, { id: "d-1", title: "same", body: "same" }, { title: "same", body: "same" });
  await handleDiscussionUpdateEvent(repository, { id: "d-1", title: "new" }, null); // no previousValues
  assert.deepEqual(tracked, []);
});

// ---- subscription class ----

function schemaYielding(events: any[]) {
  const typeDefs = `
    type User { username: String }
    type UpdatedDiscussion { id: ID, title: String, body: String }
    type PreviousValues { title: String, body: String }
    type DiscussionUpdatedPayload { updatedDiscussion: UpdatedDiscussion, previousValues: PreviousValues }
    type Query { _empty: String }
    type Subscription { discussionUpdated: DiscussionUpdatedPayload }
  `;
  const resolvers = {
    Subscription: {
      discussionUpdated: {
        subscribe: async function* () {
          for (const e of events) yield { discussionUpdated: e };
        },
      },
    },
  };
  return makeExecutableSchema({ typeDefs, resolvers });
}
const flush = () => new Promise((r) => setImmediate(r));

test("service constructs and stop() is safe before start", () => {
  const { repository } = makeRepository();
  const svc = new DiscussionVersionHistoryService(schemaYielding([]), repository);
  svc.stop();
});

test("service start() processes update events then the loop completes", async () => {
  const { repository, tracked } = makeRepository({ username: "alice" });
  const schema = schemaYielding([
    { updatedDiscussion: { id: "d-1", title: "new", body: "b" }, previousValues: { title: "old", body: "b" } },
    null, // invalid event -> skipped
  ]);
  const svc = new DiscussionVersionHistoryService(schema, repository);
  await svc.start();
  for (let i = 0; i < 50 && tracked.length === 0; i++) await flush();
  svc.stop();
  assert.ok(tracked.length >= 1, "processed at least the valid event");
});

test("service start() handles a subscribe error without throwing", async () => {
  const typeDefs = `type Query { _empty: String } type Subscription { discussionUpdated: String }`;
  const resolvers = {
    Subscription: { discussionUpdated: { subscribe: () => { throw new Error("no sub"); } } },
  };
  const { repository } = makeRepository();
  const svc = new DiscussionVersionHistoryService(makeExecutableSchema({ typeDefs, resolvers }), repository);
  await svc.start();
  svc.stop();
});
