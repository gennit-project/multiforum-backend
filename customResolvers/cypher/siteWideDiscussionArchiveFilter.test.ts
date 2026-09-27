import assert from "node:assert/strict";
import test from "node:test";
import { getSiteWideDiscussionsQuery } from "./cypherQueries.js";
import { buildSiteWideDiscussionPageQueries } from "./buildSiteWideDiscussionPageQueries.js";

test("sitewide discussion channel list excludes archived channel submissions", () => {
  const { countQuery, pageQuery } = buildSiteWideDiscussionPageQueries({
    hasDownload: null,
    hasSearch: false,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: false,
    sortOption: "hot",
  });

  assert.match(countQuery, /coalesce\(dc\.archived, false\) = false/);
  assert.match(pageQuery, /coalesce\(dc\.archived, false\) = false/);
  assert.match(
    getSiteWideDiscussionsQuery,
    /\$showArchived OR coalesce\(dc\.archived, false\) = false/
  );
});

test("sitewide discussion list can include archived channel submissions", () => {
  const { countQuery } = buildSiteWideDiscussionPageQueries({
    hasDownload: null,
    hasSearch: false,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: true,
    sortOption: "new",
  });

  assert.doesNotMatch(countQuery, /dc\.archived/);
});
