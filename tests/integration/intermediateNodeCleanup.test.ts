import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import { cleanupIntermediateNodes } from "../../services/intermediateNodeCleanup.js";
import { quarantineConnectorsForDeletedParent } from "../../services/intermediateNodeQuarantine.js";

const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let container: StartedNeo4jContainer;
let driver: Driver;

before(async () => {
  let builder = new Neo4jContainer("neo4j:5-community").withApoc();
  if (REUSE) builder = builder.withReuse();
  container = await builder.start();
  driver = neo4j.driver(
    container.getBoltUri(),
    neo4j.auth.basic(container.getUsername(), container.getPassword())
  );
}, { timeout: 240000 });

after(async () => {
  await driver?.close();
  if (!REUSE) await container?.stop();
});

beforeEach(async () => {
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
    await session.run(`
      CREATE (channel:Channel {uniqueName: 'general'})
      CREATE (discussion:Discussion {id: 'discussion-repair'})
      CREATE (repairDc:DiscussionChannel {
        id: 'dc-repair', discussionId: 'discussion-repair', channelUniqueName: 'general'
      })-[:POSTED_IN_CHANNEL]->(channel)
      CREATE (orphanDc:DiscussionChannel {
        id: 'dc-quarantine', discussionId: 'missing', channelUniqueName: 'general'
      })-[:POSTED_IN_CHANNEL]->(channel)
      CREATE (orphanDc)-[:CONTAINS_COMMENT]->(:Comment {id: 'preserved-comment'})
      CREATE (:User {username: 'voter'})-[:UPVOTED_DISCUSSION]->(orphanDc)

      CREATE (event:Event {id: 'event-repair'})
      CREATE (repairEc:EventChannel {
        id: 'ec-repair', eventId: 'event-repair', channelUniqueName: 'general'
      })-[:POSTED_IN_CHANNEL]->(channel)
      CREATE (orphanEc:EventChannel {
        id: 'ec-quarantine', eventId: 'missing-event', channelUniqueName: 'missing-channel'
      })
    `);
  } finally {
    await session.close();
  }
});

const count = async (query: string): Promise<number> => {
  const session = driver.session();
  try {
    const result = await session.run(query);
    return result.records[0].get("count").toNumber();
  } finally {
    await session.close();
  }
};

test("dry run reports repairs and quarantines without changing data", async () => {
  const report = await cleanupIntermediateNodes(driver);

  assert.equal(report.applied, false);
  assert.deepEqual(report.discussionChannels, {
    invalid: 2,
    repairable: 1,
    toQuarantine: 1,
    alreadyQuarantined: 0,
  });
  assert.deepEqual(report.eventChannels, {
    invalid: 2,
    repairable: 1,
    toQuarantine: 1,
    alreadyQuarantined: 0,
  });
  assert.deepEqual(report.remainingInvalid, {
    discussionChannels: 2,
    eventChannels: 2,
  });
  assert.equal(await count("MATCH (n:QuarantinedDiscussionChannel) RETURN count(n) AS count"), 0);
});

test("apply repairs unique matches and quarantines ambiguous records without data loss", async () => {
  const report = await cleanupIntermediateNodes(driver, { apply: true });

  assert.equal(report.applied, true);
  assert.deepEqual(report.remainingInvalid, {
    discussionChannels: 0,
    eventChannels: 0,
  });
  assert.equal(await count(`
    MATCH (:DiscussionChannel {id: 'dc-repair'})-[:POSTED_IN_CHANNEL]->(:Discussion {id: 'discussion-repair'})
    RETURN count(*) AS count
  `), 1);
  assert.equal(await count(`
    MATCH (:EventChannel {id: 'ec-repair'})-[:POSTED_IN_CHANNEL]->(:Event {id: 'event-repair'})
    RETURN count(*) AS count
  `), 1);
  assert.equal(await count(`
    MATCH (:QuarantinedDiscussionChannel {id: 'dc-quarantine'})-[:CONTAINS_COMMENT]->(:Comment {id: 'preserved-comment'})
    RETURN count(*) AS count
  `), 1);
  assert.equal(await count(`
    MATCH (:User {username: 'voter'})-[:UPVOTED_DISCUSSION]->(:QuarantinedDiscussionChannel {id: 'dc-quarantine'})
    RETURN count(*) AS count
  `), 1);
  assert.equal(await count("MATCH (n:DiscussionChannel {id: 'dc-quarantine'}) RETURN count(n) AS count"), 0);
});

test("parent-delete guard quarantines an orphan idempotently", async () => {
  const session = driver.session();
  try {
    await session.run(`
      CREATE (:EventChannel {
        id: 'deleted-event-connector', eventId: 'deleted-event', channelUniqueName: 'general'
      })-[:POSTED_IN_CHANNEL]->(:Channel {uniqueName: 'other'})
    `);
  } finally {
    await session.close();
  }

  assert.equal(await quarantineConnectorsForDeletedParent(driver, {
    kind: "event",
    id: "deleted-event",
  }), 1);
  assert.equal(await quarantineConnectorsForDeletedParent(driver, {
    kind: "event",
    id: "deleted-event",
  }), 0);
  assert.equal(await count(`
    MATCH (n:QuarantinedEventChannel {id: 'deleted-event-connector'})
    RETURN count(n) AS count
  `), 1);
});
