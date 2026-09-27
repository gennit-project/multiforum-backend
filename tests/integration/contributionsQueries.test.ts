// Integration tests for the contribution query resolvers against live Neo4j.
// These run the .cypher aggregation queries (getUserContributionsQuery, etc.)
// and return activity grouped by date — so they cover both the resolver and the
// shipped Cypher.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  type ImageModEnv,
} from "./imageModerationHarness.js";

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

// --- getUserContributions ---

test("getUserContributions returns a user's authored activity grouped by date", async () => {
  await run(
    `CREATE (u:User { username: 'alice' })
     CREATE (c:Comment { id: 'c1', text: 'hello', isRootComment: true, createdAt: datetime() })
     CREATE (u)-[:AUTHORED_COMMENT]->(c)`
  );

  const result = await env.resolvers.Query.getUserContributions(null, {
    username: "alice",
  });

  assert.ok(Array.isArray(result), "result should be an array");
  const total = result.reduce((sum: number, day: any) => sum + Number(day.count), 0);
  assert.ok(total >= 1, `expected at least one contribution, got ${JSON.stringify(result)}`);
});

test("getUserContributions throws when the user does not exist", async () => {
  await assert.rejects(
    env.resolvers.Query.getUserContributions(null, { username: "ghost" }),
    /not found|Failed to fetch contributions/i
  );
});

test("getUserContributions returns nothing for a user with no activity", async () => {
  await run(`CREATE (:User { username: 'quiet' })`);
  const result = await env.resolvers.Query.getUserContributions(null, {
    username: "quiet",
  });
  const total = result.reduce((sum: number, day: any) => sum + Number(day.count), 0);
  assert.equal(total, 0, "a user with no authored content has no contributions");
});

test("getUserContributions counts a cross-posted discussion once", async () => {
  await run(
    `CREATE (alice:User { username: 'alice' })
     CREATE (cats:Channel { uniqueName: 'cats' })
     CREATE (dogs:Channel { uniqueName: 'dogs' })
     CREATE (discussion:Discussion { id: 'cross-post', title: 'Hello', createdAt: datetime(), hasDownload: false })
     CREATE (catsPost:DiscussionChannel { id: 'cats-post', discussionId: 'cross-post', channelUniqueName: 'cats' })
     CREATE (dogsPost:DiscussionChannel { id: 'dogs-post', discussionId: 'cross-post', channelUniqueName: 'dogs' })
     CREATE (alice)-[:POSTED_DISCUSSION]->(discussion)
     CREATE (catsPost)-[:POSTED_IN_CHANNEL]->(discussion)
     CREATE (catsPost)-[:POSTED_IN_CHANNEL]->(cats)
     CREATE (dogsPost)-[:POSTED_IN_CHANNEL]->(discussion)
     CREATE (dogsPost)-[:POSTED_IN_CHANNEL]->(dogs)`
  );

  const result = await env.resolvers.Query.getUserContributions(null, {
    username: "alice",
  });
  const discussions = result.flatMap((day: any) =>
    day.activities.flatMap((activity: any) => activity.Discussions)
  );

  assert.equal(
    result.reduce((sum: number, day: any) => sum + Number(day.count), 0),
    1
  );
  assert.equal(discussions.length, 1);
  assert.equal(discussions[0].DiscussionChannels.length, 2);
});

test("getUserWikiEditsCount counts current and historical wiki edits only", async () => {
  await run(
    `CREATE (alice:User { username: 'alice' })
     CREATE (wikiCurrent:WikiPage {
       id: 'wiki-current',
       title: 'Current Wiki',
       slug: 'current-wiki',
       channelUniqueName: 'cats',
       createdAt: datetime()
     })
     CREATE (wikiOld:WikiPage {
       id: 'wiki-old',
       title: 'Old Wiki',
       slug: 'old-wiki',
       channelUniqueName: 'cats',
       createdAt: datetime()
     })
     CREATE (wikiRev:TextVersion {
       id: 'wiki-rev-1',
       body: 'old body',
       createdAt: datetime()
     })
     CREATE (comment:Comment {
       id: 'comment-1',
       text: 'comment',
       isRootComment: true,
       createdAt: datetime()
     })
     CREATE (commentRev:TextVersion {
       id: 'comment-rev-1',
       body: 'old comment',
       createdAt: datetime()
     })
     CREATE (discussion:Discussion {
       id: 'discussion-1',
       title: 'Discussion',
       createdAt: datetime()
     })
     CREATE (discussionRev:TextVersion {
       id: 'discussion-rev-1',
       body: 'old discussion',
       createdAt: datetime()
     })
     CREATE (alice)-[:AUTHORED_VERSION]->(wikiCurrent)
     CREATE (alice)-[:AUTHORED_VERSION]->(wikiRev)
     CREATE (alice)-[:AUTHORED_VERSION]->(commentRev)
     CREATE (alice)-[:AUTHORED_VERSION]->(discussionRev)
     CREATE (wikiOld)-[:HAS_VERSION]->(wikiRev)
     CREATE (comment)-[:HAS_VERSION]->(commentRev)
     CREATE (discussion)-[:HAS_BODY_VERSION]->(discussionRev)`
  );

  const result = await env.resolvers.Query.getUserWikiEditsCount(null, {
    username: "alice",
  });

  assert.equal(result, 2);
});

test("getUserWikiEditsCount throws when the user does not exist", async () => {
  await assert.rejects(
    env.resolvers.Query.getUserWikiEditsCount(null, { username: "ghost" }),
    /not found|Failed to fetch wiki edits count/i
  );
});

// --- getModContributions ---

test("getModContributions returns a mod's moderation actions grouped by date", async () => {
  await run(
    `CREATE (mp:ModerationProfile { displayName: 'Mod One', createdAt: datetime() })
     CREATE (ma:ModerationAction { id: 'ma1', actionType: 'report', actionDescription: 'Reported', createdAt: datetime() })
     CREATE (mp)-[:PERFORMED_MODERATION_ACTION]->(ma)`
  );

  const result = await env.resolvers.Query.getModContributions(null, {
    displayName: "Mod One",
  });

  assert.ok(Array.isArray(result));
  const total = result.reduce((sum: number, day: any) => sum + Number(day.count), 0);
  assert.ok(total >= 1, `expected at least one mod action, got ${JSON.stringify(result)}`);
});

test("getModContributions throws when the moderation profile does not exist", async () => {
  await assert.rejects(
    env.resolvers.Query.getModContributions(null, { displayName: "Nobody" }),
    /not found|Failed to fetch/i
  );
});

test("getModContributions counts an action once when related content is cross-posted", async () => {
  await run(
    `CREATE (mod:ModerationProfile { displayName: 'Mod One' })
     CREATE (action:ModerationAction { id: 'action-1', actionType: 'archive', actionDescription: 'Archived', createdAt: datetime() })
     CREATE (issue:Issue { id: 'issue-1', relatedDiscussionId: 'discussion-1' })
     CREATE (discussion:Discussion { id: 'discussion-1', title: 'Cross-posted', createdAt: datetime() })
     CREATE (cats:Channel { uniqueName: 'cats' })
     CREATE (dogs:Channel { uniqueName: 'dogs' })
     CREATE (catsPost:DiscussionChannel { id: 'cats-post', discussionId: 'discussion-1', channelUniqueName: 'cats' })
     CREATE (dogsPost:DiscussionChannel { id: 'dogs-post', discussionId: 'discussion-1', channelUniqueName: 'dogs' })
     CREATE (mod)-[:PERFORMED_MODERATION_ACTION]->(action)
     CREATE (issue)-[:ACTIVITY_ON_ISSUE]->(action)
     CREATE (catsPost)-[:POSTED_IN_CHANNEL]->(discussion)
     CREATE (catsPost)-[:POSTED_IN_CHANNEL]->(cats)
     CREATE (dogsPost)-[:POSTED_IN_CHANNEL]->(discussion)
     CREATE (dogsPost)-[:POSTED_IN_CHANNEL]->(dogs)`
  );

  const result = await env.resolvers.Query.getModContributions(null, {
    displayName: "Mod One",
  });
  const activities = result.flatMap((day: any) => day.activities);

  assert.equal(
    result.reduce((sum: number, day: any) => sum + Number(day.count), 0),
    1
  );
  assert.equal(activities.length, 1);
  assert.equal(activities[0].RelatedDiscussion.DiscussionChannels.length, 2);
});

// --- getChannelContributions ---

test("getChannelContributions lists contributors to a channel", async () => {
  await run(
    `CREATE (ch:Channel { uniqueName: 'test-channel', displayName: 'Test', createdAt: datetime() })
     CREATE (alice:User { username: 'alice' })
     CREATE (d:Discussion { id: 'disc-1', title: 'D', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc-1', discussionId: 'disc-1', channelUniqueName: 'test-channel', createdAt: datetime() })
     CREATE (alice)-[:POSTED_DISCUSSION]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)`
  );

  const result = await env.resolvers.Query.getChannelContributions(null, {
    channelUniqueName: "test-channel",
  });

  assert.ok(Array.isArray(result));
  const alice = result.find((c: any) => c.username === "alice");
  assert.ok(alice, `expected alice among contributors, got ${JSON.stringify(result)}`);
  assert.ok(Number(alice.totalContributions) >= 1);
});

test("getChannelContributions throws when the channel does not exist", async () => {
  await assert.rejects(
    env.resolvers.Query.getChannelContributions(null, { channelUniqueName: "ghost" }),
    /not found|Failed to fetch/i
  );
});
