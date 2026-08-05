// Unit tests for the wiki-page version-history service: the pure handler
// functions (version-author lookup + per-field version tracking) and the
// subscription class. Driven with a permissive in-memory OGM and a tiny
// executable schema. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import {
  getWikiPageVersionAuthorUsername,
  handleWikiPageUpdateEvent,
  WikiPageVersionHistoryService,
} from "./wikiPageVersionHistoryService.js";

// WikiPage.find -> authorRows; User.find -> a user so trackTextVersion proceeds.
function makeOgm(opts: { authorRows?: unknown[]; findThrows?: boolean } = {}) {
  const tracked: string[] = [];
  const ogm: any = {
    model(name: string) {
      return {
        find: async () => {
          if (opts.findThrows) throw new Error("db down");
          if (name === "WikiPage") return opts.authorRows ?? [];
          if (name === "User") return [{ username: "alice" }];
          return [];
        },
        create: async () => {
          tracked.push(`${name}.create`);
          return { textVersions: [{ id: "tv-1" }] };
        },
        update: async () => ({}),
      };
    },
  };
  return { ogm, tracked };
}

const author = [{ VersionAuthor: { username: "alice" } }];

test("getWikiPageVersionAuthorUsername returns the version author's username", async () => {
  const { ogm } = makeOgm({ authorRows: author });
  assert.equal(await getWikiPageVersionAuthorUsername(ogm, "w-1"), "alice");
});

test("getWikiPageVersionAuthorUsername returns null when missing or authorless", async () => {
  assert.equal(await getWikiPageVersionAuthorUsername(makeOgm({ authorRows: [] }).ogm, "w-1"), null);
  assert.equal(await getWikiPageVersionAuthorUsername(makeOgm({ authorRows: [{ VersionAuthor: null }] }).ogm, "w-1"), null);
});

test("getWikiPageVersionAuthorUsername swallows lookup errors", async () => {
  const { ogm } = makeOgm({ findThrows: true });
  assert.equal(await getWikiPageVersionAuthorUsername(ogm, "w-1"), null);
});

test("handleWikiPageUpdateEvent skips when the author is unknown", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: [] });
  await handleWikiPageUpdateEvent(ogm, { id: "w-1", title: "new" }, { title: "old" });
  assert.deepEqual(tracked, []);
});

test("handleWikiPageUpdateEvent tracks a title change only", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: author });
  await handleWikiPageUpdateEvent(
    ogm,
    { id: "w-1", title: "new title", body: "same" },
    { title: "old title", body: "same" }
  );
  assert.equal(tracked.filter((t) => t === "TextVersion.create").length, 1);
});

test("handleWikiPageUpdateEvent tracks both title and body when both change", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: author });
  await handleWikiPageUpdateEvent(
    ogm,
    { id: "w-1", title: "new title", body: "new body", editReason: "cleanup" },
    { title: "old title", body: "old body" }
  );
  assert.equal(tracked.filter((t) => t === "TextVersion.create").length, 2);
});

test("handleWikiPageUpdateEvent tracks nothing when unchanged or previousState missing", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: author });
  await handleWikiPageUpdateEvent(ogm, { id: "w-1", title: "same", body: "same" }, { title: "same", body: "same" });
  await handleWikiPageUpdateEvent(ogm, { id: "w-1", title: "new" }, null);
  assert.deepEqual(tracked, []);
});

// ---- subscription class ----

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
          for (const e of events) yield { wikiPageUpdated: e };
        },
      },
    },
  };
  return makeExecutableSchema({ typeDefs, resolvers });
}
const flush = () => new Promise((r) => setImmediate(r));

test("service constructs and stop() is safe before start", () => {
  const { ogm } = makeOgm();
  const svc = new WikiPageVersionHistoryService(schemaYielding([]), ogm);
  svc.stop();
});

test("service start() processes update events then the loop completes", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: author });
  const schema = schemaYielding([
    { updatedWikiPage: { id: "w-1", title: "new", body: "b" }, previousState: { title: "old", body: "b" } },
    null,
  ]);
  const svc = new WikiPageVersionHistoryService(schema, ogm);
  await svc.start();
  for (let i = 0; i < 50 && tracked.length === 0; i++) await flush();
  svc.stop();
  assert.ok(tracked.length >= 1, "processed at least the valid event");
});

test("service start() handles a subscribe error without throwing", async () => {
  const typeDefs = `type Query { _empty: String } type Subscription { wikiPageUpdated: String }`;
  const resolvers = {
    Subscription: { wikiPageUpdated: { subscribe: () => { throw new Error("no sub"); } } },
  };
  const { ogm } = makeOgm();
  const svc = new WikiPageVersionHistoryService(makeExecutableSchema({ typeDefs, resolvers }), ogm);
  await svc.start();
  svc.stop();
});
