import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import {
  assertReplyRelationship,
  MAX_REPLY_DEPTH,
} from "../../services/replyAncestry.js";
import { runNeo4jSchemaAudit } from "../../services/neo4jSchemaAudit.js";

const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let container: StartedNeo4jContainer;
let driver: Driver;

before(async () => {
  let builder = new Neo4jContainer("neo4j:5-community");
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
  await run("MATCH (n) DETACH DELETE n");
});

const run = async (
  query: string,
  params: Record<string, unknown> = {}
) => {
  const session = driver.session();
  try {
    return await session.run(query, params);
  } finally {
    await session.close();
  }
};

const seedChain = async (depth: number) => {
  await run(
    `
    UNWIND range(0, $depth) AS index
    CREATE (:Comment {id: 'comment-' + toString(index)})
    WITH collect(index) AS indexes
    UNWIND indexes AS index
    WITH index WHERE index > 0
    MATCH (child:Comment {id: 'comment-' + toString(index)})
    MATCH (parent:Comment {id: 'comment-' + toString(index - 1)})
    CREATE (child)-[:IS_REPLY_TO]->(parent)
    `,
    { depth }
  );
};

test("allows a reply at the maximum supported depth", async () => {
  await seedChain(MAX_REPLY_DEPTH - 1);

  await assert.doesNotReject(assertReplyRelationship({
    driver,
    parentCommentId: `comment-${MAX_REPLY_DEPTH - 1}`,
    childCommentId: "new-comment",
  }));
});

test("rejects a missing parent comment", async () => {
  await assert.rejects(assertReplyRelationship({
    driver,
    parentCommentId: "missing-parent",
    childCommentId: "new-comment",
  }), /Could not find the comment/);
});

test("rejects a direct self-cycle before querying Neo4j", async () => {
  await run("CREATE (:Comment {id: 'same-comment'})");

  await assert.rejects(assertReplyRelationship({
    driver,
    parentCommentId: "same-comment",
    childCommentId: "same-comment",
  }), /cannot reply to itself/);
});

test("rejects a reply beyond the maximum supported depth", async () => {
  await seedChain(MAX_REPLY_DEPTH);

  await assert.rejects(assertReplyRelationship({
    driver,
    parentCommentId: `comment-${MAX_REPLY_DEPTH}`,
    childCommentId: "new-comment",
  }), /more than 32 levels/);
});

test("rejects an indirect cycle during reparenting", async () => {
  await seedChain(2);

  await assert.rejects(assertReplyRelationship({
    driver,
    parentCommentId: "comment-2",
    childCommentId: "comment-0",
    allowParentReplacement: true,
  }), /would create a cycle/);
});

test("rejects a parent that already belongs to a reply cycle", async () => {
  await run(`
    CREATE (a:Comment {id: 'cycle-a'})
    CREATE (b:Comment {id: 'cycle-b'})
    CREATE (c:Comment {id: 'cycle-c'})
    CREATE (a)-[:IS_REPLY_TO]->(b)
    CREATE (b)-[:IS_REPLY_TO]->(c)
    CREATE (c)-[:IS_REPLY_TO]->(a)
  `);

  await assert.rejects(assertReplyRelationship({
    driver,
    parentCommentId: "cycle-a",
    childCommentId: "new-comment",
  }), /invalid ancestry chain/);
});

test("rejects a parent chain containing multiple parents", async () => {
  await seedChain(2);
  await run(`
    CREATE (other:Comment {id: 'other-parent'})
    WITH other
    MATCH (child:Comment {id: 'comment-2'})
    CREATE (child)-[:IS_REPLY_TO]->(other)
  `);

  await assert.rejects(assertReplyRelationship({
    driver,
    parentCommentId: "comment-2",
    childCommentId: "new-comment",
  }), /thread with multiple parents/);
});

test("requires explicit overwrite or disconnect to replace a parent", async () => {
  await run(`
    CREATE (oldParent:Comment {id: 'old-parent'})
    CREATE (newParent:Comment {id: 'new-parent'})
    CREATE (child:Comment {id: 'child'})-[:IS_REPLY_TO]->(oldParent)
  `);

  await assert.rejects(assertReplyRelationship({
    driver,
    parentCommentId: "new-parent",
    childCommentId: "child",
  }), /disconnect or overwrite/);
  await assert.doesNotReject(assertReplyRelationship({
    driver,
    parentCommentId: "new-parent",
    childCommentId: "child",
    allowParentReplacement: true,
  }));
});

test("rejects a child that already has multiple parents", async () => {
  await run(`
    CREATE (first:Comment {id: 'first-parent'})
    CREATE (second:Comment {id: 'second-parent'})
    CREATE (replacement:Comment {id: 'replacement-parent'})
    CREATE (child:Comment {id: 'child'})-[:IS_REPLY_TO]->(first)
    CREATE (child)-[:IS_REPLY_TO]->(second)
  `);

  await assert.rejects(assertReplyRelationship({
    driver,
    parentCommentId: "replacement-parent",
    childCommentId: "child",
    allowParentReplacement: true,
  }), /multiple reply parents/);
});

test("allows reconnecting a child to its existing parent", async () => {
  await run(`
    CREATE (parent:Comment {id: 'parent'})
    CREATE (child:Comment {id: 'child'})-[:IS_REPLY_TO]->(parent)
  `);

  await assert.doesNotReject(assertReplyRelationship({
    driver,
    parentCommentId: "parent",
    childCommentId: "child",
  }));
});

test("schema audit reports over-depth threads", async () => {
  await seedChain(MAX_REPLY_DEPTH + 1);

  const report = await runNeo4jSchemaAudit(driver);

  assert.equal(report.integrity.commentsOverMaxReplyDepth, 1);
  assert.equal(report.integrity.commentsInReplyCycles, 0);
});

test("schema audit reports reply cycles and multiple parents", async () => {
  await run(`
    CREATE (a:Comment {id: 'cycle-a'})
    CREATE (b:Comment {id: 'cycle-b'})
    CREATE (c:Comment {id: 'cycle-c'})
    CREATE (other:Comment {id: 'other-parent'})
    CREATE (a)-[:IS_REPLY_TO]->(b)
    CREATE (b)-[:IS_REPLY_TO]->(c)
    CREATE (c)-[:IS_REPLY_TO]->(a)
    CREATE (c)-[:IS_REPLY_TO]->(other)
  `);

  const report = await runNeo4jSchemaAudit(driver);

  assert.equal(report.integrity.commentsInReplyCycles, 3);
  assert.equal(report.integrity.commentsWithMultipleParents, 1);
  assert.equal(report.integrity.commentsOverMaxReplyDepth, 0);
});
