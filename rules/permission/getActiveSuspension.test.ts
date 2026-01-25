import assert from "node:assert/strict";
import test from "node:test";
import { getActiveSuspension } from "./getActiveSuspension.js";

type SuspensionStub = {
  id: string;
  username?: string | null;
  modProfileName?: string | null;
  suspendedUntil?: string | null;
  suspendedIndefinitely?: boolean | null;
  RelatedIssue?: { id: string; issueNumber?: number | null } | null;
  SuspendedUser?: { username: string } | null;
  SuspendedMod?: { displayName: string } | null;
};

type ChannelFindResult = {
  SuspendedUsers?: SuspensionStub[];
  SuspendedMods?: SuspensionStub[];
};

class ChannelModelStub {
  private result: ChannelFindResult;

  constructor(result: ChannelFindResult) {
    this.result = result;
  }

  async find() {
    return [this.result];
  }
}

const buildOgm = (channelResult: ChannelFindResult) => {
  const channelStub = new ChannelModelStub(channelResult);
  return {
    model: (name: string) => {
      if (name === "Channel") return channelStub;
      throw new Error(`Unexpected model lookup: ${name}`);
    },
  };
};

const futureDate = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastDate = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

test("returns active user suspension and issue metadata", async () => {
  const ogm = buildOgm({
    SuspendedUsers: [
      {
        id: "1",
        username: "alice",
        suspendedUntil: futureDate(),
        suspendedIndefinitely: false,
        RelatedIssue: { id: "issue-123", issueNumber: 123 },
      },
    ],
  });

  const result = await getActiveSuspension({
    ogm,
    channelUniqueName: "forum-1",
    username: "alice",
  });

  assert.equal(result.isSuspended, true);
  assert.equal(result.activeSuspension?.id, "1");
  assert.equal(result.relatedIssueId, "issue-123");
  assert.equal(result.relatedIssueNumber, 123);
  assert.equal(result.expiredUserSuspensions.length, 0);
  assert.equal(result.expiredModSuspensions.length, 0);
  assert.equal(result.suspendedEntity, "user");
});

test("returns expired suspensions for cleanup", async () => {
  const ogm = buildOgm({
    SuspendedUsers: [
      {
        id: "old",
        username: "alice",
        suspendedUntil: pastDate(),
        suspendedIndefinitely: false,
        RelatedIssue: { id: "issue-old" },
      },
    ],
  });

  const result = await getActiveSuspension({
    ogm,
    channelUniqueName: "forum-1",
    username: "alice",
  });

  // User is not suspended (suspension expired)
  assert.equal(result.isSuspended, false);
  assert.equal(result.activeSuspension, null);

  // Expired suspensions are returned for the caller to handle
  assert.equal(result.expiredUserSuspensions.length, 1);
  assert.equal(result.expiredUserSuspensions[0].id, "old");
  assert.equal(result.expiredModSuspensions.length, 0);
});

test("returns active mod suspension and issue metadata", async () => {
  const ogm = buildOgm({
    SuspendedMods: [
      {
        id: "mod-1",
        modProfileName: "ModA",
        suspendedIndefinitely: true,
        RelatedIssue: { id: "issue-999", issueNumber: 999 },
      },
    ],
  });

  const result = await getActiveSuspension({
    ogm,
    channelUniqueName: "forum-2",
    modProfileName: "ModA",
  });

  assert.equal(result.isSuspended, true);
  assert.equal(result.suspendedEntity, "mod");
  assert.equal(result.relatedIssueId, "issue-999");
  assert.equal(result.relatedIssueNumber, 999);
});

test("keeps indefinite suspensions active", async () => {
  const ogm = buildOgm({
    SuspendedUsers: [
      {
        id: "indefinite",
        username: "alice",
        suspendedUntil: pastDate(), // Even with a past date
        suspendedIndefinitely: true, // Indefinite flag takes precedence
        RelatedIssue: { id: "issue-indefinite" },
      },
    ],
  });

  const result = await getActiveSuspension({
    ogm,
    channelUniqueName: "forum-1",
    username: "alice",
  });

  assert.equal(result.isSuspended, true);
  assert.equal(result.activeSuspension?.id, "indefinite");
  assert.equal(result.expiredUserSuspensions.length, 0);
});
