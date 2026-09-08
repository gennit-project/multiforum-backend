import assert from "node:assert/strict";
import test from "node:test";
import {
  getDiscussionChannelsQuery,
  getSiteWideDiscussionsQuery,
  getSiteWideIssuesQuery,
  getUserContributionsQuery,
  getChannelContributionsQuery,
  getModContributionsQuery,
} from "./cypherQueries.js";

const occurrences = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].length;

test("site-wide discussion count and result queries filter sensitive records", () => {
  assert.equal(
    occurrences(
      getSiteWideDiscussionsQuery,
      /\$mayAccessSensitiveContent OR coalesce\(d\.hasSensitiveContent, false\) = false/g
    ),
    2
  );
});

test("channel discussion count and result queries filter sensitive records", () => {
  assert.equal(
    occurrences(
      getDiscussionChannelsQuery,
      /\$mayAccessSensitiveContent OR coalesce\(visibleDiscussion\.hasSensitiveContent, false\) = false/g
    ),
    2
  );
});

test("issue count and result queries hide reports of sensitive discussions, comments, and images", () => {
  assert.equal(
    occurrences(getSiteWideIssuesQuery, /\$mayAccessSensitiveContent OR/g),
    2
  );
  assert.equal(
    occurrences(
      getSiteWideIssuesQuery,
      /sensitiveDiscussion:Discussion \{id: issue\.relatedDiscussionId\}/g
    ),
    2
  );
  assert.equal(
    occurrences(
      getSiteWideIssuesQuery,
      /Comment \{id: issue\.relatedCommentId\}/g
    ),
    6
  );
  assert.equal(
    occurrences(
      getSiteWideIssuesQuery,
      /sensitiveImage:Image \{id: issue\.relatedImageId\}/g
    ),
    2
  );
});

test("user and channel contribution feeds filter sensitive posts and comments before counting", () => {
  assert.equal(
    occurrences(getUserContributionsQuery, /\$mayAccessSensitiveContent OR/g),
    2
  );
  assert.equal(
    occurrences(getChannelContributionsQuery, /\$mayAccessSensitiveContent OR/g),
    2
  );
});

test("custom discussion projections omit individually sensitive images", () => {
  assert.equal(
    occurrences(
      getSiteWideDiscussionsQuery,
      /\$mayAccessSensitiveContent OR coalesce\(image\.hasSensitiveContent, false\) = false/g
    ),
    1
  );
  assert.equal(
    occurrences(
      getDiscussionChannelsQuery,
      /\$mayAccessSensitiveContent OR coalesce\(image\.hasSensitiveContent, false\) = false/g
    ),
    1
  );
});

test("moderation contribution feeds omit sensitive action and feedback records", () => {
  assert.equal(
    occurrences(getModContributionsQuery, /NOT \$mayAccessSensitiveContent AND/g),
    2
  );
});
