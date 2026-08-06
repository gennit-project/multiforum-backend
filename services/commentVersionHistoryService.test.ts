// Unit tests for the comment version-history service: the pure handler functions
// (author lookup + saving the previous text as a version) and the subscription
// class. Driven with a permissive in-memory OGM and a tiny executable schema. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import { makeExecutableSchema } from "@graphql-tools/schema";
import {
  getCommentAuthorUsername,
  handleCommentUpdateEvent,
  CommentVersionHistoryService,
} from "./commentVersionHistoryService.js";

// Comment.find -> authorRows; User.find -> a user so trackTextVersion proceeds.
function makeOgm(opts: { authorRows?: unknown[] } = {}) {
  const tracked: string[] = [];
  const ogm: any = {
    model(name: string) {
      return {
        find: async () => {
          if (name === "Comment") return opts.authorRows ?? [];
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

const userAuthor = [{ CommentAuthor: { username: "alice" } }];
const modAuthor = [{ CommentAuthor: { displayName: "ModAlice" } }];

test("getCommentAuthorUsername returns a User author's username", async () => {
  const { ogm } = makeOgm({ authorRows: userAuthor });
  assert.equal(await getCommentAuthorUsername(ogm, "c-1"), "alice");
});

test("getCommentAuthorUsername falls back to a ModerationProfile displayName", async () => {
  const { ogm } = makeOgm({ authorRows: modAuthor });
  assert.equal(await getCommentAuthorUsername(ogm, "c-1"), "ModAlice");
});

test("getCommentAuthorUsername returns null when the comment is missing", async () => {
  const { ogm } = makeOgm({ authorRows: [] });
  assert.equal(await getCommentAuthorUsername(ogm, "c-1"), null);
});

test("handleCommentUpdateEvent records the previous text as a version", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: userAuthor });
  await handleCommentUpdateEvent(ogm, { id: "c-1", text: "new" }, { text: "old" });
  assert.equal(tracked.filter((t) => t === "TextVersion.create").length, 1);
});

test("handleCommentUpdateEvent does nothing when text is unchanged or absent", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: userAuthor });
  await handleCommentUpdateEvent(ogm, { id: "c-1", text: "same" }, { text: "same" });
  await handleCommentUpdateEvent(ogm, { id: "c-1", text: "new" }, null);
  assert.deepEqual(tracked, []);
});

test("handleCommentUpdateEvent skips when the author cannot be resolved", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: [] });
  await handleCommentUpdateEvent(ogm, { id: "c-1", text: "new" }, { text: "old" });
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
  const { ogm } = makeOgm();
  const svc = new CommentVersionHistoryService(schemaYielding([]), ogm);
  svc.stop();
});

test("service start() processes update events then the loop completes", async () => {
  const { ogm, tracked } = makeOgm({ authorRows: userAuthor });
  const schema = schemaYielding([
    { updatedComment: { id: "c-1", text: "new" }, previousValues: { text: "old" } },
    null,
  ]);
  const svc = new CommentVersionHistoryService(schema, ogm);
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
  const { ogm } = makeOgm();
  const svc = new CommentVersionHistoryService(makeExecutableSchema({ typeDefs, resolvers }), ogm);
  await svc.start();
  svc.stop();
});
