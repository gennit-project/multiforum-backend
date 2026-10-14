import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../types/context.js";
import {
  createIssueWithTargetIdentity,
  createIssuesWithTargetIdentity,
  protectIssueIdentityUpdate,
} from "./issueIdentityMiddleware.js";

const info = {} as never;
const resolve = async (
  _parent: unknown,
  args: Record<string, unknown>
) => args;
const connect = (key: string, value: string) => ({
  connect: { where: { node: { [key]: value } } },
});
const input = {
  issueNumber: 1,
  authorName: "Moderator",
  Author: { ModerationProfile: connect("displayName", "Moderator") },
  channelUniqueName: "cats",
  relatedDiscussionId: "discussion-1",
};

test("generated issue creation derives scope and target relationships", async () => {
  const result = await createIssuesWithTargetIdentity(
    resolve as never,
    null,
    { input: [input] },
    {} as GraphQLContext,
    info
  ) as Record<string, any>;
  assert.deepEqual(result.input[0].Channel, connect("uniqueName", "cats"));
  assert.deepEqual(
    result.input[0].TargetDiscussion,
    connect("id", "discussion-1")
  );
});

test("custom issue creation preserves the singular input shape", async () => {
  const result = await createIssueWithTargetIdentity(
    resolve as never,
    null,
    { input },
    {} as GraphQLContext,
    info
  ) as Record<string, any>;
  assert.equal(Array.isArray(result.input), false);
  assert.deepEqual(result.input.TargetDiscussion, connect("id", "discussion-1"));
});

test("generic updates may change lifecycle fields but not identity", async () => {
  const allowed = await protectIssueIdentityUpdate(
    resolve as never,
    null,
    { update: { isOpen: false, locked: true } },
    {} as GraphQLContext,
    info
  );
  assert.deepEqual(allowed, { update: { isOpen: false, locked: true } });

  await assert.rejects(
    protectIssueIdentityUpdate(
      resolve as never,
      null,
      { update: { TargetDiscussion: { disconnect: true } } },
      {} as GraphQLContext,
      info
    ),
    /Issue identity cannot be updated/
  );
});
