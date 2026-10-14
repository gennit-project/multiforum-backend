import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import neo4j, { type Driver } from "neo4j-driver";
import {
  auditIssueTargets,
  migrateIssueTargets,
} from "../../services/issueTargetMigration.js";
import { isSensitiveContentTarget } from "../../services/sensitiveContentTarget.js";
import { issueTargetDefinitions } from "../../services/issueTargetIdentity.js";

let container: StartedNeo4jContainer;
let driver: Driver;

before(async () => {
  container = await new Neo4jContainer("neo4j:5-community").start();
  driver = neo4j.driver(
    container.getBoltUri(),
    neo4j.auth.basic(container.getUsername(), container.getPassword())
  );
  await driver.getServerInfo();
}, { timeout: 240_000 });

after(async () => {
  await driver?.close();
  await container?.stop();
});

beforeEach(async () => {
  await driver.executeQuery(`
    MATCH (node)
    WHERE node:Issue OR node:Discussion OR node:Comment OR node:Event
       OR node:WikiPage OR node:TextVersion OR node:Image OR node:Album
       OR node:User OR node:ModerationProfile OR node:Channel
    DETACH DELETE node
  `);
});

test("migration links live targets and preserves deleted-target snapshots", async () => {
  await driver.executeQuery(`
    CREATE (:Discussion {id: 'discussion-1'})
    CREATE (:User {username: 'alice'})
    CREATE (:Issue {
      id: 'issue-live',
      relatedDiscussionId: 'discussion-1',
      relatedUsername: 'alice'
    })
    CREATE (:Issue {
      id: 'issue-deleted',
      relatedDiscussionId: 'deleted-discussion'
    })
  `);

  const audit = await auditIssueTargets(driver);
  assert.equal(audit.missingRelationships.length, 2);
  assert.equal(audit.missingTargets.length, 1);
  assert.equal(audit.invalidRelationships.length, 0);

  const result = await migrateIssueTargets(driver);
  assert.equal(result.linkedByRelationship.TARGETS_DISCUSSION, 1);
  assert.equal(result.linkedByRelationship.TARGETS_USER, 1);

  const linked = await driver.executeQuery(`
    MATCH (:Issue {id: 'issue-live'})-[relationship]->(target)
    RETURN type(relationship) AS relationshipType,
           coalesce(target.id, target.username) AS targetIdentity
    ORDER BY relationshipType
  `);
  assert.deepEqual(linked.records.map((record) => ({
    relationshipType: record.get("relationshipType"),
    targetIdentity: record.get("targetIdentity"),
  })), [
    { relationshipType: "TARGETS_DISCUSSION", targetIdentity: "discussion-1" },
    { relationshipType: "TARGETS_USER", targetIdentity: "alice" },
  ]);

  const afterAudit = await auditIssueTargets(driver);
  assert.equal(afterAudit.missingRelationships.length, 0);
  assert.equal(afterAudit.missingTargets.length, 1);
});

test("migration refuses a relationship that disagrees with its snapshot", async () => {
  await driver.executeQuery(`
    CREATE (expected:Discussion {id: 'discussion-1'})
    CREATE (wrong:Discussion {id: 'discussion-2'})
    CREATE (issue:Issue {id: 'issue-1', relatedDiscussionId: expected.id})
    CREATE (issue)-[:TARGETS_DISCUSSION]->(wrong)
  `);

  const audit = await auditIssueTargets(driver);
  assert.equal(audit.invalidRelationships.length, 1);
  await assert.rejects(
    migrateIssueTargets(driver),
    /Cannot backfill issue targets/
  );
});

test("migration supports every typed issue target", async () => {
  await driver.executeQuery(`
    CREATE (:Discussion {id: 'discussion-1'})
    CREATE (:Comment {id: 'comment-1'})
    CREATE (:Event {id: 'event-1'})
    CREATE (:WikiPage {id: 'wiki-1'})
    CREATE (:TextVersion {id: 'revision-1'})
    CREATE (:Image {id: 'image-1'})
    CREATE (:Album {id: 'album-1'})
    CREATE (:User {username: 'alice'})
    CREATE (:User {username: 'avatar-user'})
    CREATE (:ModerationProfile {displayName: 'Moderator'})
    CREATE (:Channel {uniqueName: 'cats'})
    CREATE (:Issue {id: 'discussion-issue', relatedDiscussionId: 'discussion-1'})
    CREATE (:Issue {id: 'comment-issue', relatedCommentId: 'comment-1'})
    CREATE (:Issue {id: 'event-issue', relatedEventId: 'event-1'})
    CREATE (:Issue {id: 'wiki-issue', relatedWikiPageId: 'wiki-1'})
    CREATE (:Issue {id: 'revision-issue', relatedWikiRevisionId: 'revision-1'})
    CREATE (:Issue {id: 'image-issue', relatedImageId: 'image-1'})
    CREATE (:Issue {id: 'album-issue', relatedAlbumId: 'album-1'})
    CREATE (:Issue {id: 'user-issue', relatedUsername: 'alice'})
    CREATE (:Issue {id: 'mod-issue', relatedModProfileName: 'Moderator'})
    CREATE (:Issue {id: 'avatar-issue', relatedProfilePicUserId: 'avatar-user'})
    CREATE (:Issue {id: 'channel-issue', relatedChannelUniqueName: 'cats'})
  `);

  const result = await migrateIssueTargets(driver);
  assert.deepEqual(
    Object.entries(result.linkedByRelationship)
      .filter(([, count]) => count > 0)
      .map(([relationshipType]) => relationshipType)
      .sort(),
    issueTargetDefinitions.map(({ relationshipType }) => relationshipType).sort()
  );
});

test("issue reads prefer a live relationship and fall back to its snapshot", async () => {
  await driver.executeQuery(`
    CREATE (snapshot:Discussion {id: 'snapshot', hasSensitiveContent: true})
    CREATE (live:Discussion {id: 'live', hasSensitiveContent: false})
    CREATE (issue:Issue {id: 'issue-1', relatedDiscussionId: snapshot.id})
    CREATE (issue)-[:TARGETS_DISCUSSION]->(live)
  `);

  assert.equal(
    await isSensitiveContentTarget(driver, { issueId: "issue-1" }),
    false
  );

  await driver.executeQuery(`
    MATCH (:Issue {id: 'issue-1'})-[relationship:TARGETS_DISCUSSION]->()
    DELETE relationship
  `);
  assert.equal(
    await isSensitiveContentTarget(driver, { issueId: "issue-1" }),
    true
  );
});
