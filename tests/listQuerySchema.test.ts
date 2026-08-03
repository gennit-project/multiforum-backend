import assert from "node:assert/strict";
import test from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { parse, validate } from "graphql";
import typeDefs from "../typeDefs.js";

const schema = await new Neo4jGraphQL({ typeDefs }).getSchema();

const assertValid = (source: string) => {
  const errors = validate(schema, parse(source));
  assert.deepEqual(
    errors.map((error) => error.message),
    []
  );
};

test("channel list clients can request assigned discussion flairs", () => {
  assertValid(`
    query ListDiscussions($channelUniqueName: String!) {
      getDiscussionsInChannel(
        channelUniqueName: $channelUniqueName
        searchInput: ""
        selectedTags: []
        showArchived: false
      ) {
        discussionChannels {
          Flairs {
            id
            channelUniqueName
            displayName
            color
            order
            archived
          }
        }
      }
    }
  `);
});

test("sitewide list clients can request non-removed download scan states", () => {
  assertValid(`
    query ListSitewideDiscussions {
      getSiteWideDiscussionList(
        searchInput: ""
        selectedChannels: []
        selectedTags: []
        showArchived: false
      ) {
        discussions {
          DownloadableFiles(where: { permanentlyRemoved_NOT: true }) {
            id
            scanStatus
          }
        }
      }
    }
  `);
});
