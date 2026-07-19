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
      flaggedServerRuleViolation: true,
      createdAt: datetime() - duration({days: 20})
    })
    CREATE (channelIssue:Issue {
      id: 'issue-2',
      issueNumber: 2,
      channelUniqueName: 'general',
      title: 'Channel-only issue',
      isOpen: true,
      flaggedServerRuleViolation: false,
      createdAt: datetime() - duration({days: 20})
    })
    CREATE (serverIssue:Issue {
      id: 'issue-3',
      issueNumber: 3,
      title: 'Server request',
      isOpen: true,
      createdAt: datetime() - duration({days: 2})
    })
    CREATE (action:ModerationAction {
      id: 'action-1',
      actionType: 'comment',
      actionDescription: 'Reviewed',
      createdAt: datetime()
    })
    CREATE (failedFile:DownloadableFile {
      id: 'file-failed',
      fileName: 'failed.zip',
      kind: 'OTHER',
      url: 'https://example.com/failed.zip',
      createdAt: datetime(),
      scanStatus: 'FAILED'
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
    CREATE (general)-[:HAS_ISSUE]->(channelIssue)
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
  assert.equal(result.summary.openIssueCount, 2);
  assert.equal(result.summary.issueOpenedCount, 2);
  assert.equal(result.summary.moderationActionCount, 1);
  assert.equal(result.summary.failedDownloadScanCount, 1);

  const general = result.channelHealth.find(
    (row: any) => row.channelUniqueName === "general"
  );
  assert.ok(general, `expected general row, got ${JSON.stringify(result.channelHealth)}`);
  assert.equal(general.id, "general");
  assert.equal(general.uniqueContributorCount, 2);
  assert.equal(general.openIssueCount, 1);
  assert.equal(general.healthLabel, "Needs review");

  assert.ok(result.timeSeries.length > 0);
  assert.equal(result.issueAging.reduce((sum: number, bucket: any) => sum + bucket.count, 0), 2);
  assert.ok(
    result.attentionItems.some((item: any) => item.title === "Stale open issues"),
    `expected stale issue attention item, got ${JSON.stringify(result.attentionItems)}`
  );
  assert.ok(
    result.attentionItems.some((item: any) => item.title === "Download security scans failing"),
    `expected scan failure attention item, got ${JSON.stringify(result.attentionItems)}`
  );
});

test("getServerHealthDashboard buckets months-old open issues into the 30+ day aging bucket", async () => {
  await run(
    `
    CREATE (oldServerIssue:Issue {
      id: 'issue-old',
      issueNumber: 10,
      title: 'Six month old server request',
      isOpen: true,
      flaggedServerRuleViolation: true,
      createdAt: datetime() - duration({days: 200})
    })
    `
  );

  const result = await env.resolvers.Query.getServerHealthDashboard(null, {
    startDate: "2000-01-01",
    endDate: "2100-01-01",
    limit: 10,
  });

  const oldBucket = result.issueAging.find(
    (bucket: any) => bucket.label === "30+ days"
  );
  assert.equal(oldBucket?.count, 1);
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

test("getServerHealthDashboard sorts channel rows before applying the limit", async () => {
  await run(
    `
    CREATE (active:Channel { uniqueName: 'active', createdAt: datetime() })
    CREATE (stale:Channel { uniqueName: 'stale', createdAt: datetime() })
    CREATE (u:User { username: 'alice' })
    CREATE (d1:Discussion { id: 'd1', title: 'One', createdAt: datetime() })
    CREATE (d2:Discussion { id: 'd2', title: 'Two', createdAt: datetime() })
    CREATE (dc1:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'active', createdAt: datetime() })
    CREATE (dc2:DiscussionChannel { id: 'dc2', discussionId: 'd2', channelUniqueName: 'active', createdAt: datetime() })
    CREATE (oldIssue:Issue {
      id: 'old-issue',
      issueNumber: 50,
      channelUniqueName: 'stale',
      title: 'Old stale issue',
      isOpen: true,
      flaggedServerRuleViolation: true,
      createdAt: datetime() - duration({days: 45})
    })
    CREATE (u)-[:POSTED_DISCUSSION]->(d1)
    CREATE (u)-[:POSTED_DISCUSSION]->(d2)
    CREATE (dc1)-[:POSTED_IN_CHANNEL]->(active)
    CREATE (dc1)-[:POSTED_IN_CHANNEL]->(d1)
    CREATE (dc2)-[:POSTED_IN_CHANNEL]->(active)
    CREATE (dc2)-[:POSTED_IN_CHANNEL]->(d2)
    CREATE (stale)-[:HAS_ISSUE]->(oldIssue)
    `
  );

  const result = await env.resolvers.Query.getServerHealthDashboard(null, {
    startDate: "2000-01-01",
    endDate: "2100-01-01",
    limit: 1,
    sortBy: "oldestOpenIssueAgeDays",
    sortDirection: "desc",
  });

  assert.equal(result.channelHealth.length, 1);
  assert.equal(result.channelHealth[0].channelUniqueName, "stale");
  assert.equal(result.summary.discussionCount, 2);
  assert.equal(result.summary.activeChannelCount, 1);
});
