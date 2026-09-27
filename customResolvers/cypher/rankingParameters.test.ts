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

const channelDiscussionPageQuery = buildDiscussionChannelPageQuery({
  hasDownload: null,
  hasLabelFilters: false,
  hasSearch: false,
  hasSelectedTags: false,
  showArchived: false,
  showUnanswered: false,
  sortOption: "hot",
});

const rankingQueries = {
  sitewideDiscussions: getSiteWideDiscussionsQuery,
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
