import assert from "node:assert/strict";
import test from "node:test";
import {
  getDiscussionChannelsQuery,
  getSiteWideDiscussionsQuery,
} from "./cypherQueries.js";

const assertProjectsAssignedFlairs = (query: string) => {
  assert.match(
    query,
    /\(dc\)-\[:HAS_DISCUSSION_FLAIR\]->\(assignedFlair:DiscussionFlair\)/
  );
  assert.match(query, /Flairs:/);
  for (const field of [
    "id",
    "channelUniqueName",
    "displayName",
    "color",
    "order",
    "archived",
  ]) {
    assert.match(query, new RegExp(`${field}: flair\\.${field}`));
  }
};

test("channel discussion lists project assigned flair metadata", () => {
  assertProjectsAssignedFlairs(getDiscussionChannelsQuery);
});

test("sitewide discussion lists project each channel's assigned flair metadata", () => {
  assertProjectsAssignedFlairs(getSiteWideDiscussionsQuery);
});

test("channel discussion flair projection keeps configured ordering metadata", () => {
  assert.match(
    getDiscussionChannelsQuery,
    /ORDER BY assignedFlair\.order ASC, assignedFlair\.displayName ASC/
  );
});

test("sitewide discussion lists project public download scan metadata", () => {
  assert.match(
    getSiteWideDiscussionsQuery,
    /\(d\)-\[:HAS_DOWNLOADABLE_FILE\]->\(downloadableFile:DownloadableFile\)/
  );
  assert.match(
    getSiteWideDiscussionsQuery,
    /downloadableFile\.permanentlyRemoved IS NULL OR downloadableFile\.permanentlyRemoved = false/
  );
  assert.match(getSiteWideDiscussionsQuery, /id: downloadableFile\.id/);
  assert.match(
    getSiteWideDiscussionsQuery,
    /scanStatus: downloadableFile\.scanStatus/
  );
  assert.match(
    getSiteWideDiscussionsQuery,
    /DownloadableFiles: downloadableFiles/
  );
});
