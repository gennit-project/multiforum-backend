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

test("getServerHealthDashboard returns summary, time series, channel rows, and attention items", async () => {
  await run(
    `
    CREATE (general:Channel { uniqueName: 'general', displayName: 'General', createdAt: datetime() })
    CREATE (quiet:Channel { uniqueName: 'quiet', displayName: 'Quiet', createdAt: datetime() })
    CREATE (alice:User { username: 'alice' })
    CREATE (bob:User { username: 'bob' })
    CREATE (mod:ModerationProfile { displayName: 'Mod One', createdAt: datetime() })

    CREATE (discussion:Discussion { id: 'disc-1', title: 'Discussion', createdAt: datetime(), hasDownload: true })
    CREATE (dc:DiscussionChannel {
      id: 'dc-1',
      discussionId: 'disc-1',
      channelUniqueName: 'general',
      createdAt: datetime(),
      archived: false,
      locked: false
    })
    CREATE (comment:Comment { id: 'comment-1', text: 'hi', isRootComment: true, createdAt: datetime(), archived: false })
    CREATE (event:Event {
      id: 'event-1',
      title: 'Event',
      createdAt: datetime(),
      startTime: datetime(),
      endTime: datetime() + duration({days: 1}),
      canceled: false,
      deleted: false
    })
    CREATE (ec:EventChannel {
      id: 'ec-1',
      eventId: 'event-1',
      channelUniqueName: 'general',
      createdAt: datetime(),
      archived: false
    })
    CREATE (issue:Issue {
      id: 'issue-1',
      issueNumber: 1,
      channelUniqueName: 'general',
      title: 'Stale issue',
      isOpen: true,
      createdAt: datetime() - duration({days: 10})
    })
    CREATE (action:ModerationAction {
      id: 'action-1',
      actionType: 'comment',
      actionDescription: 'Reviewed',
      createdAt: datetime()
    })

    CREATE (alice)-[:POSTED_DISCUSSION]->(discussion)
    CREATE (bob)-[:AUTHORED_COMMENT]->(comment)
    CREATE (alice)-[:POSTED_BY]->(event)
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(general)
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (dc)-[:CONTAINS_COMMENT]->(comment)
    CREATE (ec)-[:POSTED_IN_CHANNEL]->(general)
    CREATE (ec)-[:POSTED_IN_CHANNEL]->(event)
    CREATE (general)-[:HAS_ISSUE]->(issue)
    CREATE (issue)-[:ACTIVITY_ON_ISSUE]->(action)
    CREATE (mod)-[:PERFORMED_MODERATION_ACTION]->(action)
    CREATE (bob)-[:UPVOTED_DISCUSSION]->(dc)
    CREATE (alice)-[:UPVOTED_COMMENT]->(comment)
    `
  );

  const result = await env.resolvers.Query.getServerHealthDashboard(null, {
    startDate: "2000-01-01",
    endDate: "2100-01-01",
    limit: 10,
  });

  assert.equal(result.summary.activeChannelCount, 1);
  assert.equal(result.summary.discussionCount, 1);
  assert.equal(result.summary.commentCount, 1);
  assert.equal(result.summary.eventCount, 1);
  assert.equal(result.summary.downloadCount, 1);
  assert.equal(result.summary.voteCount, 2);
  assert.equal(result.summary.openIssueCount, 1);
  assert.equal(result.summary.issueOpenedCount, 1);
  assert.equal(result.summary.moderationActionCount, 1);

  const general = result.channelHealth.find(
    (row: any) => row.channelUniqueName === "general"
  );
  assert.ok(general, `expected general row, got ${JSON.stringify(result.channelHealth)}`);
  assert.equal(general.uniqueContributorCount, 2);
  assert.equal(general.healthLabel, "Needs review");

  assert.ok(result.timeSeries.length > 0);
  assert.equal(result.issueAging.reduce((sum: number, bucket: any) => sum + bucket.count, 0), 1);
  assert.ok(
    result.attentionItems.some((item: any) => item.title === "Stale open issues"),
    `expected stale issue attention item, got ${JSON.stringify(result.attentionItems)}`
  );
});

test("getServerHealthDashboard filters channel rows without limiting summary totals", async () => {
  await run(
    `
    CREATE (a:Channel { uniqueName: 'a', createdAt: datetime() })
    CREATE (b:Channel { uniqueName: 'b', createdAt: datetime() })
    CREATE (u:User { username: 'alice' })
    CREATE (da:Discussion { id: 'da', title: 'A', createdAt: datetime() })
    CREATE (db:Discussion { id: 'db', title: 'B', createdAt: datetime() })
    CREATE (dca:DiscussionChannel { id: 'dca', discussionId: 'da', channelUniqueName: 'a', createdAt: datetime() })
    CREATE (dcb:DiscussionChannel { id: 'dcb', discussionId: 'db', channelUniqueName: 'b', createdAt: datetime() })
    CREATE (u)-[:POSTED_DISCUSSION]->(da)
    CREATE (u)-[:POSTED_DISCUSSION]->(db)
    CREATE (dca)-[:POSTED_IN_CHANNEL]->(a)
    CREATE (dca)-[:POSTED_IN_CHANNEL]->(da)
    CREATE (dcb)-[:POSTED_IN_CHANNEL]->(b)
    CREATE (dcb)-[:POSTED_IN_CHANNEL]->(db)
    `
  );

  const result = await env.resolvers.Query.getServerHealthDashboard(null, {
    startDate: "2000-01-01",
    endDate: "2100-01-01",
    limit: 1,
  });

  assert.equal(result.channelHealth.length, 1);
  assert.equal(result.summary.discussionCount, 2);
  assert.equal(result.summary.activeChannelCount, 2);
});
