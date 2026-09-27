import assert from "node:assert/strict";
import test from "node:test";
import {
  getModContributionsQuery,
  getUserContributionsQuery,
} from "./cypherQueries.js";

const occurrences = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].length;

test("user contribution activity types are isolated in scoped subqueries", () => {
  assert.ok(occurrences(getUserContributionsQuery, /^CALL \{/gm) >= 4);
  assert.match(
    getUserContributionsQuery,
    /DiscussionChannels: discussionChannels/
  );
  assert.match(getUserContributionsQuery, /EventChannels: eventChannels/);
});

test("moderator contribution channel collections are scoped per activity", () => {
  assert.ok(occurrences(getModContributionsQuery, /^CALL \{/gm) >= 2);
  assert.match(
    getModContributionsQuery,
    /DiscussionChannels: relatedDiscussionChannels/
  );
  assert.match(
    getModContributionsQuery,
    /EventChannels: relatedEventChannels/
  );
  assert.match(
    getModContributionsQuery,
    /DiscussionChannels: feedbackDiscussionChannels/
  );
});
