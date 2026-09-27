import assert from "node:assert/strict";
import test from "node:test";
import {
  getCommentRepliesQuery,
  getCommentsQuery,
  getDiscussionChannelsQuery,
  getEventCommentsQuery,
  getSiteWideDiscussionsQuery,
} from "./cypherQueries.js";

const rankingQueries = {
  sitewideDiscussions: getSiteWideDiscussionsQuery,
  channelDiscussions: getDiscussionChannelsQuery,
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

test("channel discussions paginate before expanding related records", () => {
  const pagination = getDiscussionChannelsQuery.indexOf(
    "SKIP toInteger($offset)"
  );
  const relationshipExpansion = getDiscussionChannelsQuery.indexOf(
    "OPTIONAL MATCH (d)-[:HAS_TAG]->(tag:Tag)"
  );

  assert.ok(pagination >= 0);
  assert.ok(relationshipExpansion >= 0);
  assert.ok(pagination < relationshipExpansion);
});
