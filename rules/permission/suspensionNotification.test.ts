import assert from "node:assert/strict";
import test from "node:test";
import type { SuspensionEffectsRepository } from "../../services/persistence/suspensionEffectsRepository.js";
import { createSuspensionNotification } from "./suspensionNotification.js";

const buildRepository = () => {
  const notifications: Array<{ username: string; text: string }> = [];
  const repository: SuspensionEffectsRepository = {
    async createBlockNotification(input) {
      notifications.push(input);
      return "created";
    },
    async disconnectExpiredChannelSuspensions() {},
    async disconnectExpiredServerSuspensions() {},
  };
  return { notifications, repository };
};

test("formats a dated channel suspension notification", async () => {
  const { notifications, repository } = buildRepository();

  await createSuspensionNotification({
    repository,
    username: "alice",
    scopeName: "forum-1",
    scopeType: "channel",
    permission: "canCreateDiscussion",
    relatedIssueId: "issue-123",
    relatedIssueNumber: 123,
    suspendedUntil: "2030-01-15T00:00:00.000Z",
    suspendedIndefinitely: false,
    actorType: "user",
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.username, "alice");
  assert.match(notifications[0]?.text ?? "", /in forum-1/);
  assert.match(
    notifications[0]?.text ?? "",
    /\[Issue #123\]\(\/forums\/forum-1\/issues\/123\)/
  );
  assert.match(
    notifications[0]?.text ?? "",
    /Suspension expires on 2030-01-15\./
  );
});

test("formats an indefinite moderator suspension", async () => {
  const { notifications, repository } = buildRepository();

  await createSuspensionNotification({
    repository,
    username: "mod-user",
    scopeName: "forum-2",
    scopeType: "channel",
    permission: "canHideDiscussion",
    relatedIssueNumber: 77,
    suspendedIndefinitely: true,
    actorType: "mod",
  });

  assert.match(
    notifications[0]?.text ?? "",
    /Your moderator account is suspended in forum-2/
  );
  assert.match(notifications[0]?.text ?? "", /Suspension is indefinite\./);
});

test("formats server-scoped issue links", async () => {
  const { notifications, repository } = buildRepository();

  await createSuspensionNotification({
    repository,
    username: "alice",
    scopeName: "main",
    scopeType: "server",
    permission: "canCreateChannel",
    relatedIssueNumber: 45,
    suspendedIndefinitely: true,
    actorType: "user",
  });

  assert.match(notifications[0]?.text ?? "", /\/admin\/issues\/45/);
});

test("uses the issue id fallback and omits an unknown expiry", async () => {
  const { notifications, repository } = buildRepository();

  await createSuspensionNotification({
    repository,
    username: "alice",
    scopeName: "forum-1",
    scopeType: "channel",
    permission: "canCreateComment",
    relatedIssueId: "issue-abc",
    actorType: "user",
  });

  assert.match(notifications[0]?.text ?? "", /See Issue issue-abc/);
  assert.doesNotMatch(notifications[0]?.text ?? "", /Suspension expires/);
});

test("does not query persistence for an empty username", async () => {
  const { notifications, repository } = buildRepository();

  await createSuspensionNotification({
    repository,
    username: "",
    scopeName: "forum-1",
    scopeType: "channel",
    permission: "canCreateComment",
    actorType: "user",
  });

  assert.deepEqual(notifications, []);
});
