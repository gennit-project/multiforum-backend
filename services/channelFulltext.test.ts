import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChannelFulltextQuery,
  CHANNEL_FULLTEXT_INDEX,
  CHANNEL_FULLTEXT_CREATE_CYPHER,
} from "./channelFulltext.js";

test("appends a prefix wildcard so partial terms match longer tokens", () => {
  // "dog" should still match a "dogs" token, preserving the old CONTAINS feel.
  assert.equal(buildChannelFulltextQuery("dog"), "dog*");
});

test("ANDs multiple whitespace-separated terms, each wildcarded", () => {
  assert.equal(buildChannelFulltextQuery("all about"), "all* AND about*");
});

test("collapses surrounding and interior whitespace", () => {
  assert.equal(buildChannelFulltextQuery("  cat   meetup  "), "cat* AND meetup*");
});

test("escapes Lucene metacharacters so input is matched literally", () => {
  // The trailing "*" is the wildcard we add; the interior specials are escaped.
  assert.equal(buildChannelFulltextQuery("c++"), "c\\+\\+*");
  assert.equal(buildChannelFulltextQuery("a:b"), "a\\:b*");
  assert.equal(buildChannelFulltextQuery("(foo)"), "\\(foo\\)*");
});

test("returns an empty string for blank or whitespace-only input", () => {
  // Callers use this to fall back to the unfiltered (match-all) path.
  assert.equal(buildChannelFulltextQuery(""), "");
  assert.equal(buildChannelFulltextQuery("   "), "");
});

test("index name and generated CREATE statement stay in sync", () => {
  assert.equal(CHANNEL_FULLTEXT_INDEX, "channelFulltext");
  assert.equal(
    CHANNEL_FULLTEXT_CREATE_CYPHER,
    "CREATE FULLTEXT INDEX channelFulltext IF NOT EXISTS FOR (n:Channel) ON EACH [n.uniqueName, n.description]"
  );
});
