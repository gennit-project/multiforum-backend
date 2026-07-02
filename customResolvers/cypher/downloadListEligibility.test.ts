import test from "node:test";
import assert from "node:assert/strict";
import {
  getDiscussionChannelsQuery,
  getSiteWideDiscussionsQuery,
  getUserContributionsQuery,
} from "./cypherQueries.js";

const downloadListRequirementPattern =
  /d\.hasDownload = true[\s\S]*HAS_DOWNLOADABLE_FILE/;

test("sitewide download list query requires an attached downloadable file when hasDownload is true", () => {
  assert.match(getSiteWideDiscussionsQuery, downloadListRequirementPattern);
  assert.match(
    getSiteWideDiscussionsQuery,
    /hasDownload controls discussion presentation[\s\S]*download list membership/
  );
});

test("channel download list query requires an attached downloadable file when hasDownload is true", () => {
  assert.match(getDiscussionChannelsQuery, downloadListRequirementPattern);
  assert.match(
    getDiscussionChannelsQuery,
    /hasDownload controls discussion presentation[\s\S]*attached DownloadableFile/
  );
});

test("channel download label filters honor include and exclude filter group modes", () => {
  assert.match(
    getDiscussionChannelsQuery,
    /fg\.mode = "EXCLUDE"[\s\S]*NOT EXISTS[\s\S]*excludedOption\.value IN labelFilter\.values/
  );
  assert.match(
    getDiscussionChannelsQuery,
    /ELSE EXISTS[\s\S]*includedOption\.value IN labelFilter\.values/
  );
});

test("channel download label filters are scoped to the current channel's filter groups", () => {
  assert.match(
    getDiscussionChannelsQuery,
    /:Channel \{uniqueName: dc\.channelUniqueName\}\)-\[:HAS_FILTER_GROUP\]->\(fg:FilterGroup \{key: labelFilter\.groupKey\}\)/
  );
});

test("user contributions query still treats hasDownload as a presentation flag without list-only file gating", () => {
  assert.match(
    getUserContributionsQuery,
    /Downloads:\s*\[a IN activities[\s\S]*a\.hasDownload = true/
  );
  assert.doesNotMatch(getUserContributionsQuery, /HAS_DOWNLOADABLE_FILE/);
});
