import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Driver } from "neo4j-driver";
import { createContentChannelPermissionRepository } from "../../services/persistence/contentChannelPermissionRepository.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = await startNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);
});

after(async () => {
  await stopNeo4j();
});

test("finds every supported comment channel path and deduplicates names", async () => {
  await driver.executeQuery(`
    CREATE (directChannel:Channel {uniqueName: "direct"})
    CREATE (directComment:Comment {id: "comment-direct"})
    CREATE (discussionComment:Comment {id: "comment-discussion"})
    CREATE (eventComment:Comment {id: "comment-event"})
    CREATE (issueComment:Comment {id: "comment-issue"})
    CREATE (discussionEntry:DiscussionChannel {
      id: "discussion-channel-1",
      channelUniqueName: "discussion"
    })
    CREATE (event:Event {id: "event-1"})
    CREATE (eventEntryOne:EventChannel {
      id: "event-channel-1",
      channelUniqueName: "events"
    })
    CREATE (eventEntryTwo:EventChannel {
      id: "event-channel-2",
      channelUniqueName: "events"
    })
    CREATE (issue:Issue {id: "issue-1", channelUniqueName: "issues"})
    CREATE (directChannel)-[:HAS_COMMENT]->(directComment)
    CREATE (discussionEntry)-[:CONTAINS_COMMENT]->(discussionComment)
    CREATE (event)-[:HAS_COMMENT]->(eventComment)
    CREATE (eventEntryOne)-[:POSTED_IN_CHANNEL]->(event)
    CREATE (eventEntryTwo)-[:POSTED_IN_CHANNEL]->(event)
    CREATE (issueComment)-[:ACTIVITY_ON_ISSUE]->(issue)
  `);
  const repository = createContentChannelPermissionRepository(driver, "neo4j");

  const result = await repository.findCommentChannels([
    "comment-direct",
    "comment-discussion",
    "comment-event",
    "comment-issue",
    "missing",
  ]);

  assert.equal(result.found, true);
  assert.deepEqual(
    new Set(result.channelUniqueNames),
    new Set(["direct", "discussion", "events", "issues"])
  );
});

test("finds channels for discussions and events", async () => {
  await driver.executeQuery(`
    CREATE (discussion:Discussion {id: "discussion-1"})
    CREATE (discussionEntryOne:DiscussionChannel {
      id: "discussion-channel-1",
      channelUniqueName: "cats"
    })
    CREATE (discussionEntryTwo:DiscussionChannel {
      id: "discussion-channel-2",
      channelUniqueName: "dogs"
    })
    CREATE (event:Event {id: "event-1"})
    CREATE (eventEntryOne:EventChannel {
      id: "event-channel-1",
      channelUniqueName: "cats"
    })
    CREATE (eventEntryTwo:EventChannel {
      id: "event-channel-2",
      channelUniqueName: "cats"
    })
    CREATE (discussionEntryOne)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (discussionEntryTwo)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (eventEntryOne)-[:POSTED_IN_CHANNEL]->(event)
    CREATE (eventEntryTwo)-[:POSTED_IN_CHANNEL]->(event)
  `);
  const repository = createContentChannelPermissionRepository(driver, "neo4j");

  const discussionResult = await repository.findDiscussionChannels([
    "discussion-1",
  ]);
  assert.equal(discussionResult.found, true);
  assert.deepEqual(
    new Set(discussionResult.channelUniqueNames),
    new Set(["cats", "dogs"])
  );
  assert.deepEqual(await repository.findEventChannels(["event-1"]), {
    found: true,
    channelUniqueNames: ["cats"],
  });
});

test("distinguishes missing content from content without a channel", async () => {
  await driver.executeQuery(`
    CREATE (:Comment {id: "orphan-comment"})
    CREATE (:Discussion {id: "orphan-discussion"})
    CREATE (:Event {id: "orphan-event"})
  `);
  const repository = createContentChannelPermissionRepository(driver, "neo4j");

  assert.deepEqual(await repository.findCommentChannels(["missing"]), {
    found: false,
    channelUniqueNames: [],
  });
  assert.deepEqual(await repository.findCommentChannels(["orphan-comment"]), {
    found: true,
    channelUniqueNames: [],
  });
  assert.deepEqual(
    await repository.findDiscussionChannels(["orphan-discussion"]),
    { found: true, channelUniqueNames: [] }
  );
  assert.deepEqual(await repository.findEventChannels(["orphan-event"]), {
    found: true,
    channelUniqueNames: [],
  });
});

test("finds issue channels and preserves both comment channel references", async () => {
  await driver.executeQuery(`
    CREATE (issue:Issue {id: "issue-1", channelUniqueName: "issues"})
    CREATE (orphanIssue:Issue {id: "issue-orphan"})
    CREATE (comment:Comment {id: "comment-1"})
    CREATE (orphanComment:Comment {id: "comment-orphan"})
    CREATE (discussionEntry:DiscussionChannel {
      id: "discussion-channel-1",
      channelUniqueName: "discussion"
    })
    CREATE (:DiscussionChannel {id: "discussion-channel-orphan"})
    CREATE (directChannel:Channel {uniqueName: "direct"})
    CREATE (discussionEntry)-[:CONTAINS_COMMENT]->(comment)
    CREATE (directChannel)-[:HAS_COMMENT]->(comment)
  `);
  const repository = createContentChannelPermissionRepository(driver, "neo4j");

  assert.deepEqual(await repository.findIssueChannel("issue-1"), {
    found: true,
    channelUniqueName: "issues",
  });
  assert.deepEqual(await repository.findIssueChannel("issue-orphan"), {
    found: true,
    channelUniqueName: null,
  });
  assert.deepEqual(await repository.findIssueChannel("missing"), {
    found: false,
    channelUniqueName: null,
  });
  assert.deepEqual(await repository.findCommentChannelReferences("comment-1"), {
    found: true,
    discussionChannelUniqueName: "discussion",
    directChannelUniqueName: "direct",
  });
  assert.deepEqual(
    await repository.findCommentChannelReferences("comment-orphan"),
    {
      found: true,
      discussionChannelUniqueName: null,
      directChannelUniqueName: null,
    }
  );
  assert.deepEqual(await repository.findCommentChannelReferences("missing"), {
    found: false,
    discussionChannelUniqueName: null,
    directChannelUniqueName: null,
  });
  assert.deepEqual(
    await repository.findDiscussionChannelReference("discussion-channel-1"),
    { found: true, channelUniqueName: "discussion" }
  );
  assert.deepEqual(
    await repository.findDiscussionChannelReference(
      "discussion-channel-orphan"
    ),
    { found: true, channelUniqueName: null }
  );
  assert.deepEqual(
    await repository.findDiscussionChannelReference("missing"),
    { found: false, channelUniqueName: null }
  );
});
