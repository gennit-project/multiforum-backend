import assert from "node:assert/strict";
import test from "node:test";
import { getSiteWideDiscussionsQuery } from "./cypherQueries.js";

test("sitewide discussion channel list excludes archived channel submissions", () => {
  assert.match(
    getSiteWideDiscussionsQuery,
    /MATCH \(dc:DiscussionChannel\)-\[:POSTED_IN_CHANNEL\]->\(d\)[\s\S]*AND \(dc\.archived IS NULL OR dc\.archived = false\)[\s\S]*COLLECT\(dc\) AS discussionChannels/
  );
});
