import test from "node:test";
import assert from "node:assert/strict";
import { createInAppNotification } from "./notificationHelpers.js";
import type { UserModel } from "../ogm_types.js";

// Minimal fake of the OGM User model: captures the update payload and returns a
// configurable result (or throws).
const fakeUserModel = (
  result: unknown,
  options: { throwError?: boolean } = {}
) => {
  const calls: any[] = [];
  return {
    calls,
    update: async (input: any) => {
      calls.push(input);
      if (options.throwError) {
        throw new Error("db error");
      }
      return result;
    },
  };
};

test("returns true when the update reports an updated user", async () => {
  const UserModel = fakeUserModel({ users: [{ username: "alice" }] });
  const ok = await createInAppNotification({
    UserModel: UserModel as unknown as UserModel,
    username: "alice",
    text: "hello",
  });
  assert.equal(ok, true);
});

test("returns false when no user was updated", async () => {
  const UserModel = fakeUserModel({ users: [] });
  const ok = await createInAppNotification({
    UserModel: UserModel as unknown as UserModel,
    username: "ghost",
    text: "hello",
  });
  assert.equal(ok, false);
});

test("returns false (and does not throw) when the update errors", async () => {
  const UserModel = fakeUserModel(null, { throwError: true });
  const ok = await createInAppNotification({
    UserModel: UserModel as unknown as UserModel,
    username: "alice",
    text: "hello",
  });
  assert.equal(ok, false);
});

test("targets the right user and creates an unread notification", async () => {
  const UserModel = fakeUserModel({ users: [{ username: "alice" }] });
  await createInAppNotification({
    UserModel: UserModel as unknown as UserModel,
    username: "alice",
    text: "you were mentioned",
  });

  const node =
    UserModel.calls[0].update.Notifications[0].create[0].node;
  assert.equal(UserModel.calls[0].where.username, "alice");
  assert.equal(node.text, "you were mentioned");
  assert.equal(node.read, false);
  // notificationType omitted when not supplied
  assert.equal("notificationType" in node, false);
});

test("includes notificationType when provided", async () => {
  const UserModel = fakeUserModel({ users: [{ username: "alice" }] });
  await createInAppNotification({
    UserModel: UserModel as unknown as UserModel,
    username: "alice",
    text: "feedback left",
    notificationType: "feedback",
  });

  const node =
    UserModel.calls[0].update.Notifications[0].create[0].node;
  assert.equal(node.notificationType, "feedback");
});
