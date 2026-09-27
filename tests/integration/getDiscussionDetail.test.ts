import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import {
  resetDb,
  run,
  startImageModEnv,
  stopImageModEnv,
  type ImageModEnv,
} from "./imageModerationHarness.js";
import type { GraphQLContext } from "../../types/context.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
});

const anonymousContext = (): GraphQLContext => ({
  driver: env.driver,
  ogm: env.ogm,
  req: { headers: {}, body: {} } as GraphQLContext["req"],
});

test("getDiscussionDetail returns only the requested channel and bounded viewer lists", async () => {
  await run(`
    CREATE (author:User {username: 'author', displayName: 'Author', createdAt: datetime()})
    CREATE (viewer:User {username: 'viewer', createdAt: datetime()})
    CREATE (channel:Channel {uniqueName: 'cats', displayName: 'Cats', createdAt: datetime()})
    CREATE (otherChannel:Channel {uniqueName: 'dogs', displayName: 'Dogs', createdAt: datetime()})
    CREATE (discussion:Discussion {id: 'discussion-1', title: 'Hello', body: 'Body', createdAt: datetime(), hasSensitiveContent: false})
    CREATE (entry:DiscussionChannel {id: 'entry-1', discussionId: 'discussion-1', channelUniqueName: 'cats', createdAt: datetime()})
    CREATE (otherEntry:DiscussionChannel {id: 'entry-2', discussionId: 'discussion-1', channelUniqueName: 'dogs', createdAt: datetime()})
    CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
    CREATE (entry)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (entry)-[:POSTED_IN_CHANNEL]->(channel)
    CREATE (otherEntry)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (otherEntry)-[:POSTED_IN_CHANNEL]->(otherChannel)
    CREATE (viewer)-[:UPVOTED_DISCUSSION]->(entry)
    CREATE (:User {username: 'another-voter'})-[:UPVOTED_DISCUSSION]->(entry)
  `);

  const context = anonymousContext();
  context.user = {
    username: "viewer",
    email: null,
    email_verified: true,
    data: null,
  };
  const result = await env.resolvers.Query.getDiscussionDetail(
    null,
    { discussionId: "discussion-1", channelUniqueName: "cats" },
    context
  );
  const discussion = result[0];

  assert.deepEqual(
    {
      id: discussion?.id,
      channels: discussion?.DiscussionChannels.map((entry: Record<string, unknown>) => ({
        id: entry.id,
        upvoters: entry.UpvotedByUsers,
        count: Number((entry.UpvotedByUsersAggregate as { count: number }).count),
      })),
    },
    {
      id: "discussion-1",
      channels: [
        { id: "entry-1", upvoters: [{ username: "viewer" }], count: 2 },
      ],
    }
  );
});

test("getDiscussionDetail hides sensitive discussions from an ineligible viewer", async () => {
  await run(`
    CREATE (:Discussion {
      id: 'sensitive-1',
      title: 'Hidden',
      createdAt: datetime(),
      hasSensitiveContent: true
    })
  `);
  const context = anonymousContext();
  context.mayAccessSensitiveContent = false;

  const result = await env.resolvers.Query.getDiscussionDetail(
    null,
    { discussionId: "sensitive-1", channelUniqueName: "cats" },
    context
  );

  assert.deepEqual(result, []);
});
