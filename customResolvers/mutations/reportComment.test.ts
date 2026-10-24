import assert from "node:assert/strict";
import test from "node:test";
import {
  getRelatedIssueAccountFields,
} from "./reportComment.js";

test("getRelatedIssueAccountFields maps user authors to related usernames", () => {
  const result = getRelatedIssueAccountFields({
    __typename: "User",
    username: "alice",
  });

  assert.equal(result.relatedUsername, "alice");
});

test("getRelatedIssueAccountFields maps mod authors to related mod profiles", () => {
  const result = getRelatedIssueAccountFields({
    __typename: "ModerationProfile",
    displayName: "mod-bob",
  });

  assert.equal(result.relatedModProfileName, "mod-bob");
});
