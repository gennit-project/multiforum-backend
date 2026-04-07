import assert from "node:assert/strict";
import test from "node:test";
import { getIssueCreateInput } from "./reportComment.js";

test("getIssueCreateInput preserves related mod profile targets", () => {
  const result = getIssueCreateInput({
    contextText: "Please review this mod comment",
    selectedForumRules: ["Be civil"],
    selectedServerRules: [],
    loggedInModName: "mod-alice",
    channelUniqueName: "cats",
    reportedContentType: "comment",
    relatedCommentId: "comment-1",
    relatedModProfileName: "mod-bob",
    issueNumber: 12,
  });

  assert.equal(result.relatedModProfileName, "mod-bob");
});

test("getIssueCreateInput preserves related user targets", () => {
  const result = getIssueCreateInput({
    contextText: "Please review this comment",
    selectedForumRules: ["Be civil"],
    selectedServerRules: [],
    loggedInModName: "mod-alice",
    channelUniqueName: "cats",
    reportedContentType: "comment",
    relatedCommentId: "comment-1",
    relatedUsername: "alice",
    issueNumber: 12,
  });

  assert.equal(result.relatedUsername, "alice");
});
