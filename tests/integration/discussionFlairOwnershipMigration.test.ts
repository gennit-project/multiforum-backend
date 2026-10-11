import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import type { Driver } from "neo4j-driver";
import {
  auditDiscussionFlairOwnership,
  migrateDiscussionFlairOwnership,
} from "../../services/discussionFlairOwnershipMigration.js";
import { runNeo4jSchemaAudit } from "../../services/neo4jSchemaAudit.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = await startNeo4j();
}, { timeout: 240000 });

after(async () => {
  await stopNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);
});

test("reports orphaned, multiply-owned, and mismatched legacy flairs", async () => {
  const session = driver.session();
  try {
    await session.run(`
      CREATE (cats:Channel {uniqueName: 'cats'})
      CREATE (dogs:Channel {uniqueName: 'dogs'})
      CREATE (healthy:DiscussionFlair {id: 'healthy', channelUniqueName: 'cats'})
      CREATE (mismatched:DiscussionFlair {id: 'mismatched', channelUniqueName: 'dogs'})
      CREATE (orphaned:DiscussionFlair {id: 'orphaned', channelUniqueName: 'cats'})
      CREATE (multiplyOwned:DiscussionFlair {id: 'multiply-owned'})
      CREATE (cats)-[:HAS_DISCUSSION_FLAIR]->(healthy)
      CREATE (cats)-[:HAS_DISCUSSION_FLAIR]->(mismatched)
      CREATE (cats)-[:HAS_DISCUSSION_FLAIR]->(multiplyOwned)
      CREATE (dogs)-[:HAS_DISCUSSION_FLAIR]->(multiplyOwned)
    `);
  } finally {
    await session.close();
  }

  const report = await auditDiscussionFlairOwnership(driver);

  assert.deepEqual(report.orphaned.map(({ id }) => id), ["orphaned"]);
  assert.deepEqual(report.multiplyOwned.map(({ id }) => id), [
    "multiply-owned",
  ]);
  assert.deepEqual(report.mismatched.map(({ id }) => id), [
    "mismatched",
    "orphaned",
  ]);
  await assert.rejects(
    migrateDiscussionFlairOwnership(driver),
    /orphaned or multiply-owned flairs exist/
  );
});

test("removes legacy properties while preserving relationship-derived ownership", async () => {
  const session = driver.session();
  try {
    await session.run(`
      CREATE (cats:Channel {uniqueName: 'cats'})
      CREATE (flair:DiscussionFlair {
        id: 'question',
        channelUniqueName: 'wrong-channel',
        displayName: 'Question'
      })
      CREATE (cats)-[:HAS_DISCUSSION_FLAIR]->(flair)
    `);
  } finally {
    await session.close();
  }

  const report = await migrateDiscussionFlairOwnership(driver);
  assert.equal(report.removedStoredProperties, 1);
  assert.deepEqual(report.mismatched.map(({ id }) => id), ["question"]);

  const schemaAudit = await runNeo4jSchemaAudit(driver);
  assert.equal(schemaAudit.integrity.discussionFlairsWithInvalidOwners, 0);
  assert.equal(
    schemaAudit.integrity.discussionFlairsWithStoredChannelUniqueName,
    0
  );

  const verificationSession = driver.session();
  try {
    const result = await verificationSession.run(`
      MATCH (owner:Channel)-[:HAS_DISCUSSION_FLAIR]->(flair:DiscussionFlair {id: 'question'})
      RETURN owner.uniqueName AS channelUniqueName,
             flair.channelUniqueName IS NOT NULL AS storesLegacyProperty
    `);
    assert.equal(result.records[0]?.get("channelUniqueName"), "cats");
    assert.equal(result.records[0]?.get("storesLegacyProperty"), false);
  } finally {
    await verificationSession.close();
  }
});
