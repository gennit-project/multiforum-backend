import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import neo4j, { type Driver } from "neo4j-driver";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import typeDefinitions from "../../typeDefs.js";
import { getAgeGateStatements } from "../../services/ageGate/definitions.js";
import { sweepAgeGate } from "../../services/ageGate/sweep.js";

const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";
const statements = getAgeGateStatements(typeDefinitions);

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

// One sensitive and one ordinary discussion, with content inheriting from
// each through every route the definitions follow: channel membership, deep
// reply chains, feedback comments, text versions, related-content issues and
// downloadable files.
beforeEach(async () => {
  const session = driver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
    await session.run(`
      CREATE (sd:Discussion {id: 'sd', hasSensitiveContent: true})
      CREATE (od:Discussion {id: 'od'})
      CREATE (sdc:DiscussionChannel {id: 'sdc'})-[:POSTED_IN_CHANNEL]->(sd)
      CREATE (odc:DiscussionChannel {id: 'odc'})-[:POSTED_IN_CHANNEL]->(od)

      CREATE (sRoot:Comment {id: 's-root'})<-[:CONTAINS_COMMENT]-(sdc)
      CREATE (sReply:Comment {id: 's-reply'})-[:IS_REPLY_TO]->(sRoot)
      CREATE (sDeep:Comment {id: 's-deep'})-[:IS_REPLY_TO]->(sReply)
      CREATE (oRoot:Comment {id: 'o-root'})<-[:CONTAINS_COMMENT]-(odc)
      CREATE (oReply:Comment {id: 'o-reply'})-[:IS_REPLY_TO]->(oRoot)
      CREATE (sFeedback:Comment {id: 's-feedback'})-[:HAS_FEEDBACK_COMMENT]->(sd)
      CREATE (sFeedbackOnComment:Comment {id: 's-feedback-on-comment'})-[:HAS_FEEDBACK_COMMENT]->(sDeep)

      CREATE (sd)-[:HAS_BODY_VERSION]->(:TextVersion {id: 's-body-v1'})
      CREATE (od)-[:HAS_BODY_VERSION]->(:TextVersion {id: 'o-body-v1'})
      CREATE (sReply)-[:HAS_VERSION]->(:TextVersion {id: 's-reply-v1'})
      CREATE (oReply)-[:HAS_VERSION]->(:TextVersion {id: 'o-reply-v1'})

      CREATE (:Image {id: 'sensitive-image', hasSensitiveContent: true})
      CREATE (:Issue {id: 's-issue-discussion', relatedDiscussionId: 'sd'})
      CREATE (:Issue {id: 's-issue-comment', relatedCommentId: 's-deep'})
      CREATE (:Issue {id: 's-issue-image', relatedImageId: 'sensitive-image'})
      CREATE (:Issue {id: 'o-issue-comment', relatedCommentId: 'o-reply'})

      CREATE (sd)-[:HAS_DOWNLOADABLE_FILE]->(sFile:DownloadableFile {id: 's-file'})
      CREATE (sFile)-[:HAS_VERSION]->(:FileVersion {id: 's-file-v1'})
      CREATE (od)-[:HAS_DOWNLOADABLE_FILE]->(oFile:DownloadableFile {id: 'o-file'})
      CREATE (oFile)-[:HAS_VERSION]->(:FileVersion {id: 'o-file-v1'})
    `);
  } finally {
    await session.close();
  }
});

const clearedIds = async (): Promise<string[]> => {
  const session = driver.session();
  try {
    const result = await session.run(
      "MATCH (n) WHERE n.ageGateCleared = true RETURN n.id AS id ORDER BY id"
    );
    return result.records.map((record) => record.get("id") as string);
  } finally {
    await session.close();
  }
};

const ORDINARY_IDS = [
  "o-body-v1",
  "o-file",
  "o-file-v1",
  "o-issue-comment",
  "o-reply",
  "o-reply-v1",
  "o-root",
  "odc",
];

test("a dry run reports what would be cleared and writes nothing", async () => {
  const results = await sweepAgeGate({ driver, statements, apply: false });

  assert.deepEqual(
    {
      toClear: results.reduce((sum, r) => sum + r.toClear, 0),
      cleared: await clearedIds(),
    },
    { toClear: ORDINARY_IDS.length, cleared: [] }
  );
});

test("applying clears exactly the content that inherits from nothing sensitive", async () => {
  await sweepAgeGate({ driver, statements, apply: true });

  assert.deepEqual(await clearedIds(), ORDINARY_IDS);
});

test("a second dry run after applying finds no mismatches", async () => {
  await sweepAgeGate({ driver, statements, apply: true });
  const results = await sweepAgeGate({ driver, statements, apply: false });

  assert.deepEqual(
    results.filter((r) => r.toClear + r.toUnclear > 0),
    []
  );
});

test("a cleared node under newly sensitive content is reported and un-cleared", async () => {
  await sweepAgeGate({ driver, statements, apply: true });
  const session = driver.session();
  try {
    await session.run(
      "MATCH (d:Discussion {id: 'od'}) SET d.hasSensitiveContent = true"
    );
  } finally {
    await session.close();
  }

  const dryRun = await sweepAgeGate({ driver, statements, apply: false });
  await sweepAgeGate({ driver, statements, apply: true });

  assert.deepEqual(
    {
      reportedComments: dryRun.find((r) => r.type === "Comment")?.unclearIds.sort(),
      clearedAfter: await clearedIds(),
    },
    { reportedComments: ["o-reply", "o-root"], clearedAfter: [] }
  );
});

test("batching reaches every node", async () => {
  await sweepAgeGate({ driver, statements, apply: true, batchSize: 1 });

  assert.deepEqual(await clearedIds(), ORDINARY_IDS);
});
