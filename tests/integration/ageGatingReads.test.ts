import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import { mockToken } from "./imageModerationHarness.js";

const SERVER_CONFIG_NAME = "AgeGatingReadTestServer";
const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let container: StartedNeo4jContainer;
let schema: GraphQLSchema;
let driver: Driver;
let ogm: any;

before(async () => {
  let builder = new Neo4jContainer("neo4j:5-community").withApoc();
  if (REUSE) builder = builder.withReuse();
  container = await builder.start();
  process.env.NEO4J_URI = container.getBoltUri();
  process.env.NEO4J_USER = container.getUsername();
  process.env.NEO4J_PASSWORD = container.getPassword();
  process.env.E2E_MOCK_AUTH = "true";
  process.env.SERVER_CONFIG_NAME = SERVER_CONFIG_NAME;

  const { buildPermissionedSchema } = await import(
    "../helpers/buildPermissionedSchema.js"
  );
  ({ schema, driver, ogm } = await buildPermissionedSchema());
  await ogm.init();
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  if (!REUSE) await container?.stop();
});

beforeEach(async () => {
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
    await session.run(
      `CREATE (config:ServerConfig {
         serverName: $serverName,
         sensitiveContentAgeGateEnabled: true,
         minimumSensitiveContentAge: 18
       })
       CREATE (adult:User {username: 'adult', dateOfBirth: date('2000-01-01')})
       CREATE (minor:User {username: 'minor', dateOfBirth: date('2010-01-01')})
       CREATE (unknownAge:User {username: 'unknown-age'})
       CREATE (channel:Channel {uniqueName: 'general', displayName: 'General'})
       CREATE (publicDiscussion:Discussion {
         id: 'discussion-public', title: 'Public', hasSensitiveContent: false,
         createdAt: datetime('2026-01-01T00:00:00Z')
       })
       CREATE (sensitiveDiscussion:Discussion {
         id: 'discussion-sensitive', title: 'Sensitive', hasSensitiveContent: true,
         createdAt: datetime('2026-01-02T00:00:00Z')
       })
       CREATE (publicDc:DiscussionChannel {
         id: 'dc-public', discussionId: 'discussion-public',
         channelUniqueName: 'general', createdAt: datetime('2026-01-01T00:00:00Z')
       })
       CREATE (sensitiveDc:DiscussionChannel {
         id: 'dc-sensitive', discussionId: 'discussion-sensitive',
         channelUniqueName: 'general', createdAt: datetime('2026-01-02T00:00:00Z')
       })
       CREATE (publicComment:Comment {
         id: 'comment-public', text: 'Public comment', isRootComment: true,
         createdAt: datetime('2026-01-01T01:00:00Z')
       })
       CREATE (sensitiveComment:Comment {
         id: 'comment-sensitive', text: 'Sensitive comment', isRootComment: true,
         createdAt: datetime('2026-01-02T01:00:00Z')
       })
       CREATE (publicIssue:Issue {
         id: 'issue-public', issueNumber: 1, isOpen: true,
         relatedDiscussionId: 'discussion-public'
       })
       CREATE (sensitiveIssue:Issue {
         id: 'issue-sensitive', issueNumber: 2, isOpen: true,
         relatedDiscussionId: 'discussion-sensitive'
       })
       CREATE (publicImage:Image {
         id: 'image-public', url: 'https://example.test/public.png',
         hasSensitiveContent: false
       })
       CREATE (sensitiveImage:Image {
         id: 'image-sensitive', url: 'https://example.test/sensitive.png',
         hasSensitiveContent: true
       })
       CREATE (publicDc)-[:POSTED_IN_CHANNEL]->(publicDiscussion)
       CREATE (publicDc)-[:POSTED_IN_CHANNEL]->(channel)
       CREATE (sensitiveDc)-[:POSTED_IN_CHANNEL]->(sensitiveDiscussion)
       CREATE (sensitiveDc)-[:POSTED_IN_CHANNEL]->(channel)
       CREATE (publicDc)-[:CONTAINS_COMMENT]->(publicComment)
       CREATE (sensitiveDc)-[:CONTAINS_COMMENT]->(sensitiveComment)`,
      { serverName: SERVER_CONFIG_NAME }
    );
  } finally {
    await session.close();
  }
});

const contextFor = (username?: string) => ({
  driver,
  ogm,
  req: {
    headers: username
      ? { authorization: `Bearer ${mockToken({ username, email: `${username}@e2e.test` })}` }
      : {},
    body: {},
  },
});

const execute = (source: string, username?: string) =>
  graphql({ schema, source, contextValue: contextFor(username) });

const visibleIds = async (username?: string) => {
  const result = await execute(
    `query {
      discussions(options: { sort: [{ id: ASC }] }) { id }
      discussionChannels(options: { sort: [{ id: ASC }] }) { id }
      comments(options: { sort: [{ id: ASC }] }) { id }
      issues(options: { sort: [{ id: ASC }] }) { id }
      images(options: { sort: [{ id: ASC }] }) { id }
      discussionsAggregate { count }
      channels(where: { uniqueName: "general" }) {
        DiscussionChannels(options: { sort: [{ id: ASC }] }) { id }
      }
    }`,
    username
  );

  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return result.data as any;
};

for (const [label, username] of [
  ["anonymous callers", undefined],
  ["underage callers", "minor"],
  ["callers without a birthday", "unknown-age"],
] as const) {
  test(`${label} cannot read sensitive nodes through direct, aggregate, or nested paths`, async () => {
    const data = await visibleIds(username);
    assert.deepEqual(data.discussions.map((item: any) => item.id), ["discussion-public"]);
    assert.deepEqual(data.discussionChannels.map((item: any) => item.id), ["dc-public"]);
    assert.deepEqual(data.comments.map((item: any) => item.id), ["comment-public"]);
    assert.deepEqual(data.issues.map((item: any) => item.id), ["issue-public"]);
    assert.deepEqual(data.images.map((item: any) => item.id), ["image-public"]);
    assert.equal(data.discussionsAggregate.count, 1);
    assert.deepEqual(
      data.channels[0].DiscussionChannels.map((item: any) => item.id),
      ["dc-public"]
    );
  });
}

test("an age-eligible caller can read sensitive nodes", async () => {
  const data = await visibleIds("adult");
  assert.deepEqual(data.discussions.map((item: any) => item.id), [
    "discussion-public",
    "discussion-sensitive",
  ]);
  assert.deepEqual(data.discussionChannels.map((item: any) => item.id), [
    "dc-public",
    "dc-sensitive",
  ]);
  assert.deepEqual(data.comments.map((item: any) => item.id), [
    "comment-public",
    "comment-sensitive",
  ]);
  assert.deepEqual(data.issues.map((item: any) => item.id), [
    "issue-public",
    "issue-sensitive",
  ]);
  assert.deepEqual(data.images.map((item: any) => item.id), [
    "image-public",
    "image-sensitive",
  ]);
  assert.equal(data.discussionsAggregate.count, 2);
});
