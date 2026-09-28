import assert from "node:assert/strict";
import test from "node:test";
import { print } from "graphql";
import typeDefinitions from "../typeDefs.js";
import {
  CONTENT_FULLTEXT_CREATE_STATEMENTS,
  DISCUSSION_FULLTEXT_INDEX,
  ISSUE_FULLTEXT_INDEX,
  WIKI_PAGE_FULLTEXT_INDEX,
} from "./contentFulltext.js";

test("content full-text index names stay in sync with their CREATE statements", () => {
  assert.deepEqual(
    [DISCUSSION_FULLTEXT_INDEX, ISSUE_FULLTEXT_INDEX, WIKI_PAGE_FULLTEXT_INDEX],
    ["discussionFulltext", "issueFulltext", "wikiPageFulltext"]
  );
  assert.deepEqual(CONTENT_FULLTEXT_CREATE_STATEMENTS, [
    "CREATE FULLTEXT INDEX discussionFulltext IF NOT EXISTS FOR (n:Discussion) ON EACH [n.title, n.body]",
    "CREATE FULLTEXT INDEX issueFulltext IF NOT EXISTS FOR (n:Issue) ON EACH [n.title, n.body]",
    "CREATE FULLTEXT INDEX wikiPageFulltext IF NOT EXISTS FOR (n:WikiPage) ON EACH [n.title, n.body]",
  ]);
});

test("content full-text indexes are declared in the GraphQL schema", () => {
  const schema = print(typeDefinitions);

  assert.match(
    schema,
    /indexName: "discussionFulltext", fields: \["title", "body"\]/
  );
  assert.match(
    schema,
    /indexName: "issueFulltext", fields: \["title", "body"\]/
  );
  assert.match(
    schema,
    /indexName: "wikiPageFulltext", fields: \["title", "body"\]/
  );
});
