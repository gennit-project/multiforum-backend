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
import { buildDiscussionChannelPageQuery } from "./buildDiscussionChannelPageQuery.js";
import { buildSiteWideDiscussionPageQueries } from "./buildSiteWideDiscussionPageQueries.js";

const discussionChannelPageQuery = buildDiscussionChannelPageQuery({
  hasDownload: null,
  hasLabelFilters: false,
  hasSearch: false,
  hasSelectedTags: false,
  showArchived: false,
  showUnanswered: false,
  sortOption: "hot",
});
const sitewideDiscussionQueries = buildSiteWideDiscussionPageQueries({
  hasDownload: null,
  hasSearch: false,
  hasSelectedChannels: false,
  hasSelectedTags: false,
  showArchived: false,
  sortOption: "hot",
});

const occurrences = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].length;

test("site-wide discussion count and page queries filter sensitive records", () => {
  for (const query of Object.values(sitewideDiscussionQueries)) {
    assert.equal(
      occurrences(
        query,
        /\$mayAccessSensitiveContent OR coalesce\(d\.hasSensitiveContent, false\) = false/g
      ),
      1
    );
  }
});

test("channel discussion page selection filters sensitive records once", () => {
  assert.equal(
    occurrences(
      discussionChannelPageQuery,
      /\$mayAccessSensitiveContent OR coalesce\(discussion\.hasSensitiveContent, false\) = false/g
    ),
    1
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
