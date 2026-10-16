import assert from "node:assert/strict";
import test from "node:test";
import type {
  ChannelPermissionRepository,
  ChannelPermissionSuspension,
} from "../../services/persistence/channelPermissionRepository.js";
import { getActiveSuspension } from "./getActiveSuspension.js";

const futureDate = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastDate = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const makeRepository = (
  userSuspensions: ChannelPermissionSuspension[] = [],
  modSuspensions: ChannelPermissionSuspension[] = []
): ChannelPermissionRepository => ({
  async findAuthorizationSnapshot() {
    throw new Error("unexpected snapshot lookup");
  },
  async findTargetedSuspensions() {
    return { userSuspensions, modSuspensions };
  },
});

test("returns active user suspension and issue metadata", async () => {
  const result = await getActiveSuspension({
    repository: makeRepository([
      {
        id: "user-1",
        username: "alice",
        suspendedUntil: futureDate(),
        suspendedIndefinitely: false,
        RelatedIssue: { id: "issue-123", issueNumber: 123 },
      },
    ]),
    channelUniqueName: "forum-1",
    username: "alice",
  });

  assert.equal(result.isSuspended, true);
  assert.equal(result.activeSuspension?.id, "user-1");
  assert.equal(result.relatedIssueId, "issue-123");
  assert.equal(result.relatedIssueNumber, 123);
  assert.deepEqual(result.expiredUserSuspensions, []);
  assert.equal(result.suspendedEntity, "user");
});

test("returns expired suspensions for cleanup and finds a later active one", async () => {
  const result = await getActiveSuspension({
    repository: makeRepository([
      {
        id: "expired",
        suspendedUntil: pastDate(),
        suspendedIndefinitely: false,
      },
      {
        id: "active",
        suspendedUntil: futureDate(),
        suspendedIndefinitely: false,
      },
    ]),
    channelUniqueName: "forum-1",
    username: "alice",
  });

  assert.equal(result.activeSuspension?.id, "active");
  assert.deepEqual(
    result.expiredUserSuspensions.map(({ id }) => id),
    ["expired"]
  );
});

test("keeps indefinite suspensions active even with a past end date", async () => {
  const result = await getActiveSuspension({
    repository: makeRepository([
      {
        id: "indefinite",
        suspendedUntil: pastDate(),
        suspendedIndefinitely: true,
      },
    ]),
    channelUniqueName: "forum-1",
    username: "alice",
  });

  assert.equal(result.activeSuspension?.id, "indefinite");
  assert.deepEqual(result.expiredUserSuspensions, []);
});

test("returns active mod suspension and issue metadata", async () => {
  const result = await getActiveSuspension({
    repository: makeRepository([], [
      {
        id: "mod-1",
        modProfileName: "Mod A",
        suspendedIndefinitely: true,
        RelatedIssue: { id: "issue-999", issueNumber: 999 },
      },
    ]),
    channelUniqueName: "forum-2",
    modProfileName: "Mod A",
  });

  assert.equal(result.isSuspended, true);
  assert.equal(result.suspendedEntity, "mod");
  assert.equal(result.relatedIssueId, "issue-999");
  assert.equal(result.relatedIssueNumber, 999);
});

test("prefers an active user suspension and still reports expired mod suspensions", async () => {
  const result = await getActiveSuspension({
    repository: makeRepository(
      [{ id: "user-active", suspendedUntil: futureDate() }],
      [{ id: "mod-expired", suspendedUntil: pastDate() }]
    ),
    channelUniqueName: "forum-1",
    username: "alice",
    modProfileName: "Mod A",
  });

  assert.equal(result.activeSuspension?.id, "user-active");
  assert.equal(result.suspendedEntity, "user");
  assert.deepEqual(
    result.expiredModSuspensions.map(({ id }) => id),
    ["mod-expired"]
  );
});

test("forwards both target identifiers to the repository", async () => {
  const calls: unknown[] = [];
  const repository: ChannelPermissionRepository = {
    async findAuthorizationSnapshot() {
      return null;
    },
    async findTargetedSuspensions(input) {
      calls.push(input);
      return { userSuspensions: [], modSuspensions: [] };
    },
  };

  const result = await getActiveSuspension({
    repository,
    channelUniqueName: "forum-1",
    username: "alice",
    modProfileName: "Mod A",
  });

  assert.equal(result.isSuspended, false);
  assert.equal(result.activeSuspension, null);
  assert.deepEqual(calls, [
    {
      channelUniqueName: "forum-1",
      username: "alice",
      modProfileName: "Mod A",
    },
  ]);
});

test("throws before querying when neither target identifier is provided", async () => {
  let calls = 0;
  const repository = makeRepository();
  const originalLookup = repository.findTargetedSuspensions;
  repository.findTargetedSuspensions = async (input) => {
    calls += 1;
    return originalLookup(input);
  };

  await assert.rejects(
    getActiveSuspension({ repository, channelUniqueName: "forum-1" }),
    /Must provide a username or modProfileName/
  );
  assert.equal(calls, 0);
});
