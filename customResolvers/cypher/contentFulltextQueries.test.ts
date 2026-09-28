import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscussionChannelPageQuery } from "./buildDiscussionChannelPageQuery.js";
import { buildSiteWideDiscussionPageQueries } from "./buildSiteWideDiscussionPageQueries.js";
import {
  buildSiteWideIssuesQuery,
  buildSiteWideWikiPagesQuery,
} from "./buildContentSearchQueries.js";

const fulltextCall =
  /db\.index\.fulltext\.queryNodes\(\$fulltextIndex, (?:\$fulltextQuery|fulltextQuery)\)/;

test("content search queries use full-text indexes instead of regular expressions", () => {
  const siteWide = buildSiteWideDiscussionPageQueries({
    hasDownload: null,
    hasSearch: true,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: false,
    sortOption: "new",
  });
  const inChannel = buildDiscussionChannelPageQuery({
    hasDownload: null,
    hasLabelFilters: false,
    hasSearch: true,
    hasSelectedTags: false,
    showArchived: false,
    showUnanswered: false,
    sortOption: "new",
  });

  for (const query of [
    siteWide.countQuery,
    siteWide.pageQuery,
    inChannel,
    buildSiteWideIssuesQuery(true),
    buildSiteWideWikiPagesQuery(true),
  ]) {
    assert.match(query, fulltextCall);
    assert.doesNotMatch(query, /=~/);
  }
});

test("empty discussion searches retain the normal anchored paths", () => {
  const siteWide = buildSiteWideDiscussionPageQueries({
    hasDownload: null,
    hasSearch: false,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: false,
    sortOption: "new",
  });
  const inChannel = buildDiscussionChannelPageQuery({
    hasDownload: null,
    hasLabelFilters: false,
    hasSearch: false,
    hasSelectedTags: false,
    showArchived: false,
    showUnanswered: false,
    sortOption: "new",
  });

  assert.match(siteWide.pageQuery, /^MATCH \(d:Discussion\)/);
  assert.match(inChannel, /MATCH \(dc:DiscussionChannel/);
  assert.doesNotMatch(siteWide.pageQuery, /db\.index\.fulltext/);
  assert.doesNotMatch(inChannel, /db\.index\.fulltext/);
  assert.match(buildSiteWideIssuesQuery(false), /^MATCH \(issue:Issue\)/);
  assert.match(buildSiteWideWikiPagesQuery(false), /MATCH \(w:WikiPage\)/);
  assert.doesNotMatch(buildSiteWideIssuesQuery(false), /db\.index\.fulltext/);
  assert.doesNotMatch(
    buildSiteWideWikiPagesQuery(false),
    /db\.index\.fulltext/
  );
});
