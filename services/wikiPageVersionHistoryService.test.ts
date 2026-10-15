import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import {
  getWikiPageVersionAuthorUsername,
  handleWikiPageUpdateEvent,
  WikiPageVersionHistoryService,
} from "./wikiPageVersionHistoryService.js";
import type {
  RecordTextVersionInput,
  VersionHistoryRepository,
} from "./persistence/versionHistoryRepository.js";

function makeRepository(
  opts: { username?: string | null; lookupThrows?: boolean } = {}
) {
  const tracked: RecordTextVersionInput[] = [];
  const repository: VersionHistoryRepository = {
    async getCommentAuthorName() { return null; },
    async getDiscussionAuthorUsername() { return null; },
    async getWikiPageVersionAuthorUsername() {
      if (opts.lookupThrows) throw new Error("db down");
      return opts.username ?? null;
    },
    async recordTextVersion(input) {
      tracked.push(input);
      return "tv-1";
    },
  };
  return { repository, tracked };
}

test("getWikiPageVersionAuthorUsername returns the version author's username", async () => {
  const { repository } = makeRepository({ username: "alice" });
  assert.equal(await getWikiPageVersionAuthorUsername(repository, "w-1"), "alice");
});

test("getWikiPageVersionAuthorUsername returns null when missing or authorless", async () => {
  assert.equal(
    await getWikiPageVersionAuthorUsername(makeRepository().repository, "w-1"),
    null
  );
});

test("getWikiPageVersionAuthorUsername swallows lookup errors", async () => {
  const { repository } = makeRepository({ lookupThrows: true });
  assert.equal(await getWikiPageVersionAuthorUsername(repository, "w-1"), null);
});

test("handleWikiPageUpdateEvent skips when the author is unknown", async () => {
  const { repository, tracked } = makeRepository();
  await handleWikiPageUpdateEvent(
    repository,
    { id: "w-1", title: "new" },
    { title: "old" }
  );
  assert.deepEqual(tracked, []);
});

test("handleWikiPageUpdateEvent tracks a title change only", async () => {
  const { repository, tracked } = makeRepository({ username: "alice" });
  await handleWikiPageUpdateEvent(
    repository,
    { id: "w-1", title: "new title", body: "same" },
    { title: "old title", body: "same" }
  );
  assert.deepEqual(tracked, [{
    target: "wiki-page",
    parentId: "w-1",
    body: "new title",
    editReason: undefined,
    username: "alice",
  }]);
});

test("handleWikiPageUpdateEvent tracks both changes with the edit reason", async () => {
  const { repository, tracked } = makeRepository({ username: "alice" });
  await handleWikiPageUpdateEvent(
    repository,
    { id: "w-1", title: "new title", body: "new body", editReason: "cleanup" },
    { title: "old title", body: "old body" }
  );
  assert.equal(tracked.length, 2);
  assert.ok(tracked.every(({ editReason }) => editReason === "cleanup"));
});

test("handleWikiPageUpdateEvent tracks nothing when unchanged or previous state is missing", async () => {
  const { repository, tracked } = makeRepository({ username: "alice" });
  await handleWikiPageUpdateEvent(
    repository,
    { id: "w-1", title: "same", body: "same" },
    { title: "same", body: "same" }
  );
  await handleWikiPageUpdateEvent(repository, { id: "w-1", title: "new" }, null);
  assert.deepEqual(tracked, []);
});

function schemaYielding(events: any[]) {
  const typeDefs = `
    type UpdatedWikiPage { id: ID, title: String, body: String }
    type PreviousState { title: String, body: String }
    type WikiPageUpdatedPayload { updatedWikiPage: UpdatedWikiPage, previousState: PreviousState }
    type Query { _empty: String }
    type Subscription { wikiPageUpdated: WikiPageUpdatedPayload }
  `;
  const resolvers = {
    Subscription: {
      wikiPageUpdated: {
        subscribe: async function* () {
          for (const event of events) yield { wikiPageUpdated: event };
        },
      },
    },
  };
  return makeExecutableSchema({ typeDefs, resolvers });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("service constructs and stop() is safe before start", () => {
  const { repository } = makeRepository();
  const service = new WikiPageVersionHistoryService(schemaYielding([]), repository);
  service.stop();
});

test("service start() processes update events then the loop completes", async () => {
  const { repository, tracked } = makeRepository({ username: "alice" });
  const schema = schemaYielding([
    {
      updatedWikiPage: { id: "w-1", title: "new", body: "b" },
      previousState: { title: "old", body: "b" },
    },
    null,
  ]);
  const service = new WikiPageVersionHistoryService(schema, repository);
  await service.start();
  for (let index = 0; index < 50 && tracked.length === 0; index++) await flush();
  service.stop();
  assert.ok(tracked.length >= 1, "processed at least the valid event");
});

test("service start() handles a subscribe error without throwing", async () => {
  const typeDefs = `type Query { _empty: String } type Subscription { wikiPageUpdated: String }`;
  const resolvers = {
    Subscription: {
      wikiPageUpdated: {
        subscribe: () => { throw new Error("no sub"); },
      },
    },
  };
  const { repository } = makeRepository();
  const service = new WikiPageVersionHistoryService(
    makeExecutableSchema({ typeDefs, resolvers }),
    repository
  );
  await service.start();
  service.stop();
});
