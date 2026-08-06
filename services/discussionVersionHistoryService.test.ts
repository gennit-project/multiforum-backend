// Unit tests for the discussion version-history service: the pure handler
// functions (author lookup + per-field version tracking) and the subscription
// class (start/process/stop). Driven with a permissive in-memory OGM and a tiny
// executable schema whose subscription yields controlled events. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import {
  getDiscussionAuthorUsername,
  handleDiscussionUpdateEvent,
  DiscussionVersionHistoryService,
} from "./discussionVersionHistoryService.js";

// A permissive OGM whose Discussion.find returns `authorRows` and whose
// TextVersion/parent writes are no-ops. `tracked` records TextVersion creates so
// we can assert which fields were versioned.
// Discussion.find -> authorRows (for the author lookup). User.find -> a user so
// the shared trackTextVersion helper proceeds to create the version. TextVersion
// creates are recorded in `tracked`.
function makeOgm(opts: { authorRows?: unknown[]; findThrows?: boolean } = {}) {
  const tracked: string[] = [];
  const ogm: any = {
    model(name: string) {
      return {
        find: async () => {
          if (opts.findThrows) throw new Error("db down");
          if (name === "Discussion") return opts.authorRows ?? [];
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

const author = [{ Author: { username: "alice" } }];

test("getDiscussionAuthorUsername returns the author's username", async () => {
  const { ogm } = makeOgm({ authorRows: author });
  assert.equal(await getDiscussionAuthorUsername(ogm, "d-1"), "alice");
});

test("getDiscussionAuthorUsername returns null when the discussion is missing", async () => {
  const { ogm } = makeOgm({ authorRows: [] });
  assert.equal(await getDiscussionAuthorUsername(ogm, "d-1"), null);
});

test("getDiscussionAuthorUsername returns null when there is no author", async () => {
  const { ogm } = makeOgm({ authorRows: [{ Author: null }] });
  assert.equal(await getDiscussionAuthorUsername(ogm, "d-1"), null);
});

test("getDiscussionAuthorUsername swallows lookup errors and returns null", async () => {
  const { ogm } = makeOgm({ findThrows: true });
  assert.equal(await getDiscussionAuthorUsername(ogm, "d-1"), null);
});

test("handleDiscussionUpdateEvent skips everything when the author is unknown", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: [] });
  await handleDiscussionUpdateEvent(ogm, { id: "d-1", title: "new" }, { title: "old" });
  assert.deepEqual(tracked, []);
});

test("handleDiscussionUpdateEvent tracks a title change only", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: author });
  await handleDiscussionUpdateEvent(
    ogm,
    { id: "d-1", title: "new title", body: "same" },
    { title: "old title", body: "same" }
  );
  assert.equal(tracked.filter((t) => t === "TextVersion.create").length, 1);
});

test("handleDiscussionUpdateEvent tracks both title and body when both change", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: author });
  await handleDiscussionUpdateEvent(
    ogm,
    { id: "d-1", title: "new title", body: "new body" },
    { title: "old title", body: "old body" }
  );
  assert.equal(tracked.filter((t) => t === "TextVersion.create").length, 2);
});

test("handleDiscussionUpdateEvent tracks nothing when values are unchanged or absent", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: author });
  await handleDiscussionUpdateEvent(ogm, { id: "d-1", title: "same", body: "same" }, { title: "same", body: "same" });
  await handleDiscussionUpdateEvent(ogm, { id: "d-1", title: "new" }, null); // no previousValues
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
  const { ogm } = makeOgm();
  const svc = new DiscussionVersionHistoryService(schemaYielding([]), ogm);
  svc.stop();
});

test("service start() processes update events then the loop completes", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: author });
  const schema = schemaYielding([
    { updatedDiscussion: { id: "d-1", title: "new", body: "b" }, previousValues: { title: "old", body: "b" } },
    null, // invalid event -> skipped
  ]);
  const svc = new DiscussionVersionHistoryService(schema, ogm);
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
  const { ogm } = makeOgm();
  const svc = new DiscussionVersionHistoryService(makeExecutableSchema({ typeDefs, resolvers }), ogm);
  await svc.start();
  svc.stop();
});
