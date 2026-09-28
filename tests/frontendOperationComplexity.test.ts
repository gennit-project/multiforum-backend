import assert from "node:assert/strict";
import test from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { parse } from "graphql";
import {
  calculateQueryComplexity,
  DEFAULT_MAX_QUERY_COMPLEXITY,
} from "../services/graphqlQueryComplexity.js";
import typeDefs from "../typeDefs.js";

// Kept in sync with GET_CHANNEL_CONTRIBUTIONS in the frontend. This is the
// deepest real operation in the current client and previously received a
// theoretical score in the tens of millions despite its bounded resolver.
const channelContributionsOperation = parse(`
  query getChannelContributions(
    $channelUniqueName: String!
    $startDate: String
    $endDate: String
    $year: Int
    $limit: Int
  ) {
    getChannelContributions(
      channelUniqueName: $channelUniqueName
      startDate: $startDate
      endDate: $endDate
      year: $year
      limit: $limit
    ) {
      username
      displayName
      profilePicURL
      totalContributions
      dayData {
        date
        count
        activities {
          id
          type
          description
          Comments {
            id
            text
            createdAt
            Channel {
              uniqueName
              displayName
              description
              channelIconURL
            }
            CommentAuthor {
              username
              profilePicURL
            }
            DiscussionChannel {
              id
              discussionId
              channelUniqueName
            }
          }
          Discussions {
            id
            title
            createdAt
            Author {
              username
              profilePicURL
            }
            DiscussionChannels {
              id
              channelUniqueName
              discussionId
            }
          }
        }
      }
    }
  }
`);

test("the frontend's deepest normal operation remains below the default ceiling", async () => {
  const schema = await new Neo4jGraphQL({
    typeDefs,
    features: {
      filters: { String: { MATCHES: true } },
      subscriptions: true,
    },
  }).getSchema();

  const complexity = calculateQueryComplexity({
    document: channelContributionsOperation,
    operationName: "getChannelContributions",
    schema,
    variables: {
      channelUniqueName: "example",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      year: 2026,
      limit: 10,
    },
  });

  assert.equal(complexity, 47_701);
  assert.ok(complexity < DEFAULT_MAX_QUERY_COMPLEXITY);
});
