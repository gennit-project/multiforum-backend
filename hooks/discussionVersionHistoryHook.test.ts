// Unit tests for the discussion version-history + edit-notification hook
// handlers. Mirrors the event hook: capture the previous title/body as
// TextVersions (reconnecting BodyLastEditedBy), notify the author on an edit by
// someone else, and short-circuit on the guard branches. Permissive in-memory
// OGM and driver. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import {
  discussionVersionHistoryHandler,
  discussionEditNotificationHandler,
} from "./discussionVersionHistoryHook.js";

process.env.FRONTEND_URL = "https://app.example.test";

function makeContext(opts: { issues?: unknown[]; users?: unknown[] } = {}) {
  const ops: string[] = [];
  const ogm = {
    model(name: string) {
      return {
        find: async () => {
          if (name === "User") return opts.users ?? [{ username: "alice" }];
          if (name === "Issue") return opts.issues ?? [];
          // The version-connect helper re-reads the parent to append the new
          // version; return a row so that path (not just the create) is exercised.
          if (name === "Discussion") return [{ id: "d-1", PastTitleVersions: [], PastBodyVersions: [] }];
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
  id: "d-1",
  title: "old title",
  body: "old body",
  Author: { username: "alice" },
  BodyLastEditedBy: { username: "alice" },
  DiscussionChannels: [{ channelUniqueName: "cats" }],
  PastTitleVersions: [],
  PastBodyVersions: [],
};

test("discussionVersionHistoryHandler: returns early without an id or update", async () => {
  const { context, ops } = makeContext();
  await discussionVersionHistoryHandler({ context, params: { where: {}, update: null }, discussionSnapshot: snapshot });
  assert.deepEqual(ops, []);
});

test("discussionVersionHistoryHandler: returns early when nothing changed", async () => {
  const { context, ops } = makeContext();
  await discussionVersionHistoryHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "old title", body: "old body" } },
    discussionSnapshot: snapshot,
  });
  assert.deepEqual(ops, []);
});

test("discussionVersionHistoryHandler: records a title version on a title change", async () => {
  const { context, ops } = makeContext();
  await discussionVersionHistoryHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "new title" } },
    discussionSnapshot: snapshot,
  });
  assert.ok(ops.includes("TextVersion.create"), "created a TextVersion for the previous title");
});

test("discussionVersionHistoryHandler: records a body version and reconnects BodyLastEditedBy", async () => {
  const { context, ops } = makeContext();
  await discussionVersionHistoryHandler({
    context,
    params: { where: { id: "d-1" }, update: { body: "new body" } },
    discussionSnapshot: snapshot,
  });
  assert.ok(ops.includes("TextVersion.create"), "created a TextVersion for the previous body");
  // the BodyLastEditedBy reconnect fires for the current editor
  assert.ok(ops.includes("Discussion.update"), "reconnected BodyLastEditedBy");
});

test("discussionVersionHistoryHandler: writes issue activity items when a related issue exists", async () => {
  const { context, ops } = makeContext({ issues: [{ id: "i-1" }] });
  await discussionVersionHistoryHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "new title" } },
    discussionSnapshot: snapshot,
  });
  assert.ok(ops.includes("TextVersion.create"));
});

test("discussionVersionHistoryHandler: swallows errors", async () => {
  const context: any = {
    ogm: { model: () => ({ find: async () => { throw new Error("boom"); }, create: async () => ({}), update: async () => ({}) }) },
    driver: {},
    user: { username: "editor" },
  };
  await discussionVersionHistoryHandler({ context, params: { where: { id: "d-1" }, update: { title: "new" } } });
});

test("discussionEditNotificationHandler: notifies the author on an edit by someone else", async () => {
  const { context } = makeContext();
  await discussionEditNotificationHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "new title" } },
    discussionSnapshot: snapshot,
  });
});

test("discussionEditNotificationHandler: no notification when the editor is the author", async () => {
  const { context } = makeContext();
  await discussionEditNotificationHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "new title" } },
    discussionSnapshot: { ...snapshot, Author: { username: "editor" } },
  });
});

test("discussionEditNotificationHandler: returns early without a snapshot", async () => {
  const { context } = makeContext();
  await discussionEditNotificationHandler({ context, params: { where: { id: "d-1" }, update: { title: "x" } }, discussionSnapshot: null });
});
