import test from "node:test";
import assert from "node:assert/strict";
import {
  getUserContributionsQuery,
} from "./cypherQueries.js";
import { buildDiscussionChannelPageQuery } from "./buildDiscussionChannelPageQuery.js";
import { buildSiteWideDiscussionPageQueries } from "./buildSiteWideDiscussionPageQueries.js";

const downloadPageQuery = buildDiscussionChannelPageQuery({
  hasDownload: true,
  hasLabelFilters: false,
  hasSearch: false,
  hasSelectedTags: false,
  showArchived: false,
  showUnanswered: false,
  sortOption: "hot",
});
const labelFilterPageQuery = buildDiscussionChannelPageQuery({
  hasDownload: null,
  hasLabelFilters: true,
  hasSearch: false,
  hasSelectedTags: false,
  showArchived: false,
  showUnanswered: false,
  sortOption: "hot",
});

const downloadListRequirementPattern =
  /d\.hasDownload = true[\s\S]*HAS_DOWNLOADABLE_FILE/;
const channelDownloadListRequirementPattern =
  /discussion\.hasDownload = true[\s\S]*HAS_DOWNLOADABLE_FILE/;
const { countQuery: sitewideDownloadCountQuery } =
  buildSiteWideDiscussionPageQueries({
    hasDownload: true,
    hasSearch: false,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: false,
    sortOption: "hot",
  });

test("sitewide download list query requires an attached downloadable file when hasDownload is true", () => {
  assert.match(sitewideDownloadCountQuery, downloadListRequirementPattern);
});

test("channel download list query requires an attached downloadable file when hasDownload is true", () => {
  assert.match(
    downloadPageQuery,
    channelDownloadListRequirementPattern
  );
});

test("channel download label filters honor include and exclude filter group modes", () => {
  assert.match(
    labelFilterPageQuery,
    /fg\.mode = "EXCLUDE"[\s\S]*NOT EXISTS[\s\S]*excludedOption\.value IN labelFilter\.values/
  );
  assert.match(
    labelFilterPageQuery,
    /ELSE EXISTS[\s\S]*includedOption\.value IN labelFilter\.values/
  );
});

test("channel download label filters are scoped to the current channel's filter groups", () => {
  assert.match(
    labelFilterPageQuery,
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
