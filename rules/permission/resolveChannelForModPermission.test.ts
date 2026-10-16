import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveChannelForModPermission,
  NO_CHANNEL_ERROR,
  ISSUE_NOT_FOUND_ERROR,
  COMMENT_NOT_FOUND_ERROR,
  type IssueChannelLookup,
} from "./resolveChannelForModPermission.js";

test("uses a directly provided channel and does not consult lookups", () => {
  const result = resolveChannelForModPermission({
    channelUniqueName: "cats",
    issueId: "issue-1",
    issue: { found: false, channelUniqueName: null }, // would error if consulted
  });
  assert.deepEqual(result, { channelUniqueName: "cats" });
});

test("derives the channel from a found issue", () => {
  const result = resolveChannelForModPermission({
    issueId: "issue-1",
    issue: { found: true, channelUniqueName: "dogs" },
  });
  assert.deepEqual(result, { channelUniqueName: "dogs" });
});

test("errors when the issue lookup returns nothing", () => {
  const emptyIssues: Array<IssueChannelLookup | undefined> = [
    undefined,
    { found: false, channelUniqueName: null },
  ];
  for (const issue of emptyIssues) {
    const result = resolveChannelForModPermission({ issueId: "issue-1", issue });
    assert.ok(result.error instanceof Error);
    assert.equal(result.error.message, ISSUE_NOT_FOUND_ERROR);
  }
});

test("derives the channel from a found comment", () => {
  const result = resolveChannelForModPermission({
    commentId: "comment-1",
    comment: { found: true, directChannelUniqueName: "birds" },
  });
  assert.deepEqual(result, { channelUniqueName: "birds" });
});

test("errors when the comment lookup returns nothing", () => {
  const result = resolveChannelForModPermission({
    commentId: "comment-1",
    comment: { found: false, directChannelUniqueName: null },
  });
  assert.ok(result.error instanceof Error);
  assert.equal(result.error.message, COMMENT_NOT_FOUND_ERROR);
});

test("comment channel overrides issue channel when both ids are present", () => {
  // Mirrors canArchiveAndUnarchiveComment: both branches run, comment last.
  const result = resolveChannelForModPermission({
    issueId: "issue-1",
    commentId: "comment-1",
    issue: { found: true, channelUniqueName: "from-issue" },
    comment: { found: true, directChannelUniqueName: "from-comment" },
  });
  assert.deepEqual(result, { channelUniqueName: "from-comment" });
});

test("a failed comment lookup errors even after a successful issue lookup", () => {
  const result = resolveChannelForModPermission({
    issueId: "issue-1",
    commentId: "comment-1",
    issue: { found: true, channelUniqueName: "from-issue" },
    comment: { found: false, directChannelUniqueName: null },
  });
  assert.ok(result.error instanceof Error);
  assert.equal(result.error.message, COMMENT_NOT_FOUND_ERROR);
});

test("errors when no channel can be determined", () => {
  const result = resolveChannelForModPermission({});
  assert.ok(result.error instanceof Error);
  assert.equal(result.error.message, NO_CHANNEL_ERROR);
});

test("errors when an issue is found but carries no channel name", () => {
  const result = resolveChannelForModPermission({
    issueId: "issue-1",
    issue: { found: true, channelUniqueName: null },
  });
  assert.ok(result.error instanceof Error);
  assert.equal(result.error.message, NO_CHANNEL_ERROR);
});

test("ignores ids when a direct channel is present (no lookup needed)", () => {
  const result = resolveChannelForModPermission({
    channelUniqueName: "cats",
    commentId: "comment-1",
    comment: { found: false, directChannelUniqueName: null },
  });
  assert.deepEqual(result, { channelUniqueName: "cats" });
});
