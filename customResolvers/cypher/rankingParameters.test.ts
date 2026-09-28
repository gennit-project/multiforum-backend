import assert from "node:assert/strict";
import test from "node:test";
import {
  getCommentRepliesQuery,
  getCommentsQuery,
  getDiscussionChannelsQuery,
  getEventCommentsQuery,
  getSiteWideDiscussionsQuery,
} from "./cypherQueries.js";
import { buildDiscussionChannelPageQuery } from "./buildDiscussionChannelPageQuery.js";
import { buildSiteWideDiscussionPageQueries } from "./buildSiteWideDiscussionPageQueries.js";

const channelDiscussionPageQuery = buildDiscussionChannelPageQuery({
  hasDownload: null,
  hasLabelFilters: false,
  hasSearch: false,
  hasSelectedTags: false,
  showArchived: false,
  showUnanswered: false,
  sortOption: "hot",
});
const { pageQuery: sitewideDiscussionPageQuery } =
  buildSiteWideDiscussionPageQueries({
    hasDownload: null,
    hasSearch: false,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: false,
    sortOption: "hot",
  });

const rankingQueries = {
  sitewideDiscussions: sitewideDiscussionPageQuery,
  channelDiscussions: channelDiscussionPageQuery,
  discussionComments: getCommentsQuery,
  commentReplies: getCommentRepliesQuery,
  eventComments: getEventCommentsQuery,
};

for (const [name, query] of Object.entries(rankingQueries)) {
  test(`${name} hot ranking uses server-controlled query parameters`, () => {
    assert.match(
      query,
      /log10\([^)]+ \+ 1\) \/ \(\(ageInMonths \+ \$hotAgeOffsetMonths\) \^ \$hotGravity\)/
    );
  });
}

test("channel discussions select page IDs before expanding related records", () => {
  assert.match(channelDiscussionPageQuery, /collect\(dc\.id\)/);
  assert.match(channelDiscussionPageQuery, /\$offset.*\$limit/s);
  assert.doesNotMatch(
    channelDiscussionPageQuery,
    /OPTIONAL MATCH \(d\)-\[:HAS_TAG\]->\(tag:Tag\)/
  );
  assert.match(
    getDiscussionChannelsQuery,
    /UNWIND range\(0, size\(\$discussionChannelIds\) - 1\)/
  );
  assert.match(
    getDiscussionChannelsQuery,
    /OPTIONAL MATCH \(d\)-\[:HAS_TAG\]->\(tag:Tag\)/
  );
});

test("sitewide discussions select IDs before hydrating related records", () => {
  assert.match(sitewideDiscussionPageQuery, /RETURN d\.id AS discussionId/);
  assert.doesNotMatch(sitewideDiscussionPageQuery, /SKIP/);
  assert.match(sitewideDiscussionPageQuery, /LIMIT toInteger\(\$pageLimit\)/);
  assert.match(
    sitewideDiscussionPageQuery,
    /ORDER BY hotRank DESC, d\.createdAt DESC, d\.id DESC/
  );
  assert.doesNotMatch(sitewideDiscussionPageQuery, /UPVOTED_DISCUSSION|CONTAINS_COMMENT/);
  assert.match(
    getSiteWideDiscussionsQuery,
    /UNWIND range\(0, size\(\$discussionIds\) - 1\)/
  );
  assert.match(getSiteWideDiscussionsQuery, /UPVOTED_DISCUSSION/);
});

test("sitewide cursor pages seek after the complete hot-ranking tuple", () => {
  const { pageQuery } = buildSiteWideDiscussionPageQueries({
    hasDownload: null,
    hasSearch: false,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: false,
    sortOption: "hot",
    paginationMode: "cursor",
  });

  assert.match(pageQuery, /hotRank < \$cursorScore/);
  assert.match(pageQuery, /d\.createdAt < datetime\(\$cursorCreatedAt\)/);
  assert.match(pageQuery, /d\.id < \$cursorDiscussionId/);
  assert.doesNotMatch(pageQuery, /SKIP/);
});

test("sitewide legacy offset pages retain compatibility", () => {
  const { pageQuery } = buildSiteWideDiscussionPageQueries({
    hasDownload: null,
    hasSearch: false,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: false,
    sortOption: "new",
    paginationMode: "offset",
  });

  assert.match(pageQuery, /SKIP toInteger\(\$offset\)/);
});

test("discussion comments select their page before hydrating related records", () => {
  const pageSelection = getCommentsQuery.indexOf("SKIP toInteger($offset)");
  const voterHydration = getCommentsQuery.indexOf("UPVOTED_COMMENT");

  assert.ok(pageSelection > -1);
  assert.ok(voterHydration > pageSelection);
  assert.doesNotMatch(getCommentsQuery, /HAS_SERVER_ROLE|HAS_CHANNEL_ROLE/);
});

for (const [name, query] of Object.entries({
  commentReplies: getCommentRepliesQuery,
  eventComments: getEventCommentsQuery,
})) {
  test(`${name} selects its page before hydrating related records`, () => {
    const pageSelection = query.indexOf("SKIP toInteger($offset)");
    const voterHydration = query.indexOf("UPVOTED_COMMENT");

    assert.ok(pageSelection > -1);
    assert.ok(voterHydration > pageSelection);
    assert.doesNotMatch(query, /HAS_SERVER_ROLE|HAS_CHANNEL_ROLE/);
  });
}
