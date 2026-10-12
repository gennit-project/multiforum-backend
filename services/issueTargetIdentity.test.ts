import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIssueIdentityUpdateAllowed,
  attachIssueIdentityRelationships,
  issueTargetDefinitions,
  protectIssueModelIdentity,
  validateIssueIdentityInput,
} from "./issueTargetIdentity.js";

const connect = (key: string, value: string) => ({
  connect: { where: { node: { [key]: value } } },
});

const base: Record<string, any> = {
  issueNumber: 3,
  authorName: "Moderator",
  Author: {
    ModerationProfile: connect("displayName", "Moderator"),
  },
  channelUniqueName: "cats",
};

test("derives every typed target relationship from its scalar snapshot", () => {
  for (const definition of issueTargetDefinitions) {
    const input = {
      ...base,
      [definition.scalarField]:
        definition.targetKey === "username"
          ? "alice"
          : definition.targetKey === "uniqueName"
            ? "dogs"
            : `${definition.targetLabel.toLowerCase()}-1`,
    };
    if (definition.scalarField === "relatedWikiRevisionId") {
      input.relatedWikiPageId = "wiki-1";
    }
    if (definition.scalarField === "relatedUsername") {
      delete input.channelUniqueName;
    }
    const result = attachIssueIdentityRelationships(input);
    assert.deepEqual(
      result[definition.relationshipField],
      connect(definition.targetKey, input[definition.scalarField])
    );
  }
});

test("derives the channel relationship from the immutable scope snapshot", () => {
  const result = attachIssueIdentityRelationships<Record<string, any>>({
    ...base,
    relatedDiscussionId: "discussion-1",
  });
  assert.deepEqual(result.Channel, connect("uniqueName", "cats"));
});

test("rejects a scalar and relationship target mismatch", () => {
  assert.throws(
    () => attachIssueIdentityRelationships({
      ...base,
      relatedDiscussionId: "discussion-1",
      TargetDiscussion: connect("id", "discussion-2"),
    }),
    /must match its immutable issue identity/
  );
});

test("rejects invalid target combinations", () => {
  assert.throws(
    () => validateIssueIdentityInput({
      ...base,
      relatedDiscussionId: "discussion-1",
      relatedEventId: "event-1",
    }),
    /exactly one primary target/
  );
  assert.throws(
    () => validateIssueIdentityInput({
      ...base,
      relatedWikiRevisionId: "revision-1",
    }),
    /requires its wiki page/
  );
  assert.throws(
    () => validateIssueIdentityInput(base),
    /target is required/
  );
  assert.throws(
    () => validateIssueIdentityInput({
      ...base,
      relatedUsername: "alice",
      relatedModProfileName: "Moderator",
    }),
    /cannot target both/
  );
  assert.throws(
    () => validateIssueIdentityInput({
      ...base,
      relatedChannelUniqueName: "cats",
      relatedChannelIconName: "cats",
      relatedChannelBannerName: "cats",
    }),
    /both a channel icon and banner/
  );
});

test("requires valid issue numbering and matching author identity", () => {
  assert.throws(() => validateIssueIdentityInput(null as any), /input is required/);
  assert.throws(
    () => validateIssueIdentityInput({ ...base, issueNumber: -1, relatedUsername: "alice" }),
    /non-negative integer/
  );
  assert.throws(
    () => validateIssueIdentityInput({ ...base, authorName: "", relatedUsername: "alice" }),
    /author identity is required/
  );
  assert.throws(
    () => validateIssueIdentityInput({
      ...base,
      authorName: "Someone else",
      relatedUsername: "alice",
    }),
    /author relationship must match/
  );
});

test("rejects relationship operations other than the matching connect", () => {
  assert.throws(
    () => validateIssueIdentityInput({
      ...base,
      relatedDiscussionId: "discussion-1",
      TargetDiscussion: {
        ...connect("id", "discussion-1"),
        create: { node: { id: "discussion-1" } },
      },
    }),
    /must match its immutable issue identity/
  );
});

test("allows a content target with one account snapshot", () => {
  assert.doesNotThrow(() => validateIssueIdentityInput({
    ...base,
    relatedCommentId: "comment-1",
    relatedUsername: "alice",
  }));
});

test("rejects mismatched profile and channel image snapshots", () => {
  assert.throws(
    () => validateIssueIdentityInput({
      ...base,
      relatedProfilePicUserId: "alice",
      relatedUsername: "bob",
    }),
    /must match/
  );
  assert.throws(
    () => validateIssueIdentityInput({
      ...base,
      relatedChannelUniqueName: "cats",
      relatedChannelIconName: "dogs",
    }),
    /must match the targeted channel/
  );
});

test("rejects generic updates that attempt to retarget an issue", () => {
  assert.throws(
    () => assertIssueIdentityUpdateAllowed({
      isOpen: false,
      relatedDiscussionId: "discussion-2",
    }),
    /relatedDiscussionId/
  );
  assert.doesNotThrow(() => assertIssueIdentityUpdateAllowed({
    isOpen: false,
    locked: true,
    ActivityFeed: [{ create: [] }],
  }));
});

test("protects server-side OGM creates and updates through one model wrapper", async () => {
  const calls: Array<{ operation: string; options: Record<string, any> }> = [];
  const model = protectIssueModelIdentity({
    async create(options: Record<string, any>) {
      calls.push({ operation: "create", options });
      return { issues: [] };
    },
    async update(options: Record<string, any>) {
      calls.push({ operation: "update", options });
      return { issues: [] };
    },
  });
  await model.create({
    input: [{ ...base, relatedDiscussionId: "discussion-1" }],
  });
  assert.deepEqual(
    calls[0].options.input[0].TargetDiscussion,
    connect("id", "discussion-1")
  );
  assert.throws(
    () => model.update({ update: { relatedDiscussionId: "discussion-2" } }),
    /Issue identity cannot be updated/
  );
  await model.update({ update: { isOpen: false } });
  assert.equal(calls[calls.length - 1]?.operation, "update");
});
