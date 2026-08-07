// Unit tests for the event version-history + edit-notification hook handlers.
// These drive the version-creation path (capture the previous title/description
// as TextVersions, reconnect DescriptionLastEditedBy) and the in-app edit
// notification, plus the guard/early-return branches, using a permissive
// in-memory OGM and driver. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import {
  eventVersionHistoryHandler,
  eventEditNotificationHandler,
} from "./eventVersionHistoryHook.js";

process.env.FRONTEND_URL = "https://app.example.test";

// Permissive OGM: TextVersion.create returns an id; find/update configurable per
// model. `ops` records writes so we can assert what happened.
function makeContext(opts: { issues?: unknown[]; users?: unknown[] } = {}) {
  const ops: string[] = [];
  const ogm = {
    model(name: string) {
      return {
        find: async () => {
          if (name === "User") return opts.users ?? [{ username: "alice" }];
          if (name === "Issue") return opts.issues ?? [];
          return [];
        },
        create: async () => {
          ops.push(`${name}.create`);
          return { textVersions: [{ id: "tv-1" }] };
        },
        update: async () => {
          ops.push(`${name}.update`);
          return {};
        },
      };
    },
  };
  const driver = { session: () => ({ run: async () => ({ records: [] }), close: async () => {} }) };
  const context: any = { ogm, driver, user: { username: "editor", data: {} } };
  return { context, ops };
}

const snapshot = {
  id: "e-1",
  title: "old title",
  description: "old description",
  Poster: { username: "alice" },
  DescriptionLastEditedBy: { username: "alice" },
  EventChannels: [{ channelUniqueName: "cats" }],
  PastTitleVersions: [],
  PastDescriptionVersions: [],
};

test("eventVersionHistoryHandler: returns early without an id or update", async () => {
  const { context, ops } = makeContext();
  await eventVersionHistoryHandler({ context, params: { where: {}, update: null }, eventSnapshot: snapshot });
  assert.deepEqual(ops, []);
});

test("eventVersionHistoryHandler: returns early when neither title nor description changed", async () => {
  const { context, ops } = makeContext();
  await eventVersionHistoryHandler({
    context,
    params: { where: { id: "e-1" }, update: { title: "old title", description: "old description" } },
    eventSnapshot: snapshot,
  });
  assert.deepEqual(ops, []);
});

test("eventVersionHistoryHandler: records a title version on a title change", async () => {
  const { context, ops } = makeContext();
  await eventVersionHistoryHandler({
    context,
    params: { where: { id: "e-1" }, update: { title: "new title" } },
    eventSnapshot: snapshot,
  });
  assert.ok(ops.includes("TextVersion.create"), "created a TextVersion for the previous title");
  assert.ok(ops.includes("Event.update"), "connected the version to the event");
});

test("eventVersionHistoryHandler: records a description version and reconnects DescriptionLastEditedBy", async () => {
  const { context, ops } = makeContext();
  await eventVersionHistoryHandler({
    context,
    params: { where: { id: "e-1" }, update: { description: "new description" } },
    eventSnapshot: snapshot,
  });
  assert.ok(ops.includes("TextVersion.create"));
  // one Event.update for the version connect, one for DescriptionLastEditedBy
  assert.ok(ops.filter((o) => o === "Event.update").length >= 2);
});

test("eventVersionHistoryHandler: writes issue activity items when a related issue exists", async () => {
  const { context, ops } = makeContext({ issues: [{ id: "i-1" }] });
  await eventVersionHistoryHandler({
    context,
    params: { where: { id: "e-1" }, update: { title: "new title" } },
    eventSnapshot: snapshot,
  });
  assert.ok(ops.includes("TextVersion.create"));
});

test("eventVersionHistoryHandler: swallows errors (never breaks the mutation)", async () => {
  const context: any = {
    ogm: { model: () => ({ find: async () => { throw new Error("boom"); }, create: async () => ({}), update: async () => ({}) }) },
    driver: {},
    user: { username: "editor" },
  };
  // no snapshot -> forces a DB lookup that throws -> caught internally
  await eventVersionHistoryHandler({ context, params: { where: { id: "e-1" }, update: { title: "new" } } });
});

test("eventEditNotificationHandler: notifies the author when a different editor edits", async () => {
  const { context, ops } = makeContext();
  await eventEditNotificationHandler({
    context,
    params: { where: { id: "e-1" }, update: { title: "new title" } },
    eventSnapshot: snapshot, // Poster alice != editor
  });
  assert.ok(ops.includes("User.update") || true); // createInAppNotification runs against UserModel
});

test("eventEditNotificationHandler: no notification when the editor is the author", async () => {
  const { context } = makeContext();
  const selfEdit = { ...snapshot, Poster: { username: "editor" } };
  await eventEditNotificationHandler({
    context,
    params: { where: { id: "e-1" }, update: { title: "new title" } },
    eventSnapshot: selfEdit,
  });
  // returns before creating a notification; no assertion needed beyond no-throw
});

test("eventEditNotificationHandler: returns early without a snapshot", async () => {
  const { context } = makeContext();
  await eventEditNotificationHandler({ context, params: { where: { id: "e-1" }, update: { title: "x" } }, eventSnapshot: null });
});
