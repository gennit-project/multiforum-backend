import assert from "node:assert/strict";
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

async function testCreatesNotificationWhenMissing() {
  const userModel = new UserModelStub();

  await createSuspensionNotification({
    UserModel: userModel,
    username: "alice",
    channelName: "forum-1",
    permission: "canCreateDiscussion",
    relatedIssueId: "123",
    actorType: "user",
  });

  assert.equal(userModel.updates.length, 1, "Should create a notification");
  const text = userModel.updates[0].update.Notifications[0].create[0].node.text as string;
  assert.ok(text.includes("forum-1"));
  assert.ok(text.includes("Issue 123"));
}

async function testDoesNotDuplicateNotification() {
  const existingText =
    "You are suspended in forum-1 and cannot canCreateDiscussion. See Issue 123 for details.";
  const userModel = new UserModelStub({ alice: [existingText] });

  await createSuspensionNotification({
    UserModel: userModel,
    username: "alice",
    channelName: "forum-1",
    permission: "canCreateDiscussion",
    relatedIssueId: "123",
    actorType: "user",
  });

  assert.equal(userModel.updates.length, 0, "Should not duplicate notification");
}

async function run() {
  await testCreatesNotificationWhenMissing();
  await testDoesNotDuplicateNotification();
  console.log("suspensionNotification tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
