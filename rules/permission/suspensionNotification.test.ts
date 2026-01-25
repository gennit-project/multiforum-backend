import assert from "node:assert/strict";
import test from "node:test";
import { createSuspensionNotification } from "./suspensionNotification.js";

class UserModelStub {
  public finds: any[] = [];
  public updates: any[] = [];
  private notifications: Record<string, string[]> = {};

  constructor(initialNotifications?: Record<string, string[]>) {
    this.notifications = initialNotifications || {};
  }

  async find({ where }: any) {
    const username = where.username;
    this.finds.push(where);
    const texts = this.notifications[username] || [];
    return [
      {
        Notifications: texts.map((text) => ({ id: text, text })),
      },
    ];
  }

  async update({ where, update }: any) {
    this.updates.push({ where, update });
    const username = where.username;
    const newText = update.Notifications[0].create[0].node.text;
    this.notifications[username] = [...(this.notifications[username] || []), newText];
    return {};
  }
}

test("creates notification when missing", async () => {
  const userModel = new UserModelStub();
  const suspendUntil = "2030-01-15T00:00:00.000Z";

  await createSuspensionNotification({
    UserModel: userModel,
    username: "alice",
    channelName: "forum-1",
    permission: "canCreateDiscussion",
    relatedIssueId: "issue-123",
    relatedIssueNumber: 123,
    suspendedUntil: suspendUntil,
    suspendedIndefinitely: false,
    actorType: "user",
  });

  assert.equal(userModel.updates.length, 1, "Should create a notification");
  const text = userModel.updates[0].update.Notifications[0].create[0].node
    .text as string;
  assert.ok(text.includes("forum-1"));
  assert.ok(text.includes("Issue #123"));
  assert.ok(text.includes("Suspension expires on 2030-01-15."));
});

test("does not duplicate notification", async () => {
  const existingText =
    "You are suspended in forum-1 and cannot canCreateDiscussion. See [Issue #123](/forums/forum-1/issues/123) for details. Suspension expires on 2030-01-15.";
  const userModel = new UserModelStub({ alice: [existingText] });

  await createSuspensionNotification({
    UserModel: userModel,
    username: "alice",
    channelName: "forum-1",
    permission: "canCreateDiscussion",
    relatedIssueId: "issue-123",
    relatedIssueNumber: 123,
    suspendedUntil: "2030-01-15T00:00:00.000Z",
    suspendedIndefinitely: false,
    actorType: "user",
  });

  assert.equal(userModel.updates.length, 0, "Should not duplicate notification");
});

test("formats indefinite suspension message", async () => {
  const userModel = new UserModelStub();

  await createSuspensionNotification({
    UserModel: userModel,
    username: "mod-user",
    channelName: "forum-2",
    permission: "canHideDiscussion",
    relatedIssueNumber: 77,
    suspendedIndefinitely: true,
    actorType: "mod",
  });

  assert.equal(userModel.updates.length, 1, "Should create a notification");
  const text = userModel.updates[0].update.Notifications[0].create[0].node
    .text as string;
  assert.ok(text.includes("Your moderator account is suspended in forum-2"));
  assert.ok(text.includes("Issue #77"));
  assert.ok(text.includes("Suspension is indefinite."));
});
