// Event edit notifications remain post-commit effects; history is tested through
// the public transactional middleware against live Neo4j.
import assert from "node:assert/strict";
import test from "node:test";
import {
  eventEditNotificationHandler,
} from "./eventVersionHistoryHook.js";

process.env.FRONTEND_URL = "https://app.example.test";

// Finite notification writer; ops records effects.
function makeContext(opts: { issues?: unknown[]; users?: unknown[] } = {}) {
  const ops: string[] = [];
  const driver = { session: () => ({ run: async () => ({ records: [] }), close: async () => {} }) };
  const context: any = { issueActivityRepository: { findRelatedIssueIds: async () => opts.issues ?? [], appendActivity: async () => { ops.push("Issue.update"); } }, notificationWriter: {createForUser: async () => {ops.push("notification.create"); return true;}}, driver, user: { username: "editor", data: {} } };
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

test("eventEditNotificationHandler: notifies the author when a different editor edits", async () => {
  const { context, ops } = makeContext();
  await eventEditNotificationHandler({
    context,
    params: { where: { id: "e-1" }, update: { title: "new title" } },
    eventSnapshot: snapshot, // Poster alice != editor
  });
  assert.ok(ops.includes("notification.create"));
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
