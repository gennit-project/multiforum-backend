import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import neo4j, { type Driver } from "neo4j-driver";
import {
  Neo4jContainer,
  type StartedNeo4jContainer,
} from "@testcontainers/neo4j";
import typeDefinitions from "../../typeDefs.js";
import { getAgeGateStatements } from "../../services/ageGate/definitions.js";
import { installAgeGateReconcile } from "../../services/ageGate/reconcile.js";

const REUSE = process.env.TESTCONTAINERS_REUSE_ENABLE === "true";

let container: StartedNeo4jContainer;
let driver: Driver;
let schema: GraphQLSchema;

before(async () => {
  let builder = new Neo4jContainer("neo4j:5-community").withApoc();
  if (REUSE) builder = builder.withReuse();
  container = await builder.start();
  driver = installAgeGateReconcile(
    neo4j.driver(
      container.getBoltUri(),
      neo4j.auth.basic(container.getUsername(), container.getPassword())
    ),
    getAgeGateStatements(typeDefinitions)
  );
  // No permission layer here: this exercises the reconcile mechanism under
  // generated mutations directly, including writes the interlock blocks.
  schema = await new Neo4jGraphQL({ typeDefs: typeDefinitions, driver }).getSchema();
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
      CREATE (sd:Discussion {id: 'sd', hasSensitiveContent: true})
      CREATE (od:Discussion {id: 'od'})
      CREATE (sdc:DiscussionChannel {id: 'sdc', discussionId: 'sd', channelUniqueName: 'c', ageGateRestricted: true})-[:POSTED_IN_CHANNEL]->(sd)
      CREATE (odc:DiscussionChannel {id: 'odc', discussionId: 'od', channelUniqueName: 'c'})-[:POSTED_IN_CHANNEL]->(od)
      CREATE (sRoot:Comment {id: 's-root', text: 's', ageGateRestricted: true})<-[:CONTAINS_COMMENT]-(sdc)
      CREATE (oRoot:Comment {id: 'o-root', text: 'o'})<-[:CONTAINS_COMMENT]-(odc)
      CREATE (oReply:Comment {id: 'o-reply', text: 'o'})-[:IS_REPLY_TO]->(oRoot)
      CREATE (:Image {id: 'img'})
      CREATE (:Issue {id: 'issue', issueNumber: 1, channelUniqueName: 'c'})
    `);
  } finally {
    await session.close();
  }
});

const mutate = async (source: string) => {
  const result = await graphql({
    schema,
    source,
    contextValue: { jwt: { mayAccessSensitiveContent: true } },
  });
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
};

// Generated creates assign ids, so new comments are identified by their text.
const restrictedTexts = async (): Promise<string[]> => {
  const session = driver.session();
  try {
    const result = await session.run(
      "MATCH (c:Comment) WHERE c.ageGateRestricted = true RETURN c.text AS text ORDER BY text"
    );
    return result.records.map((record) => record.get("text") as string);
  } finally {
    await session.close();
  }
};

const restricted = async (): Promise<string[]> => {
  const session = driver.session();
  try {
    const result = await session.run(
      "MATCH (n) WHERE n.ageGateRestricted = true RETURN n.id AS id ORDER BY id"
    );
    return result.records.map((record) => record.get("id") as string);
  } finally {
    await session.close();
  }
};

test("a reply created under marked content is restricted in the same transaction", async () => {
  await mutate(`mutation {
    createComments(input: [{
      text: "new reply", isRootComment: false,
      ParentComment: { connect: { where: { node: { id: "s-root" } } } }
    }]) { comments { id } }
  }`);

  assert.ok((await restrictedTexts()).includes("new reply"));
});

test("a reply created under unmarked content stays clear", async () => {
  await mutate(`mutation {
    createComments(input: [{
      text: "new reply", isRootComment: false,
      ParentComment: { connect: { where: { node: { id: "o-root" } } } }
    }]) { comments { id } }
  }`);

  assert.ok(!(await restrictedTexts()).includes("new reply"));
});

test("marking a discussion sensitive restricts everything beneath it", async () => {
  await mutate(`mutation {
    updateDiscussions(where: { id: "od" }, update: { hasSensitiveContent: true }) { discussions { id } }
  }`);

  assert.deepEqual(await restricted(), ["o-reply", "o-root", "odc", "s-root", "sdc"]);
});

test("unmarking a discussion clears everything beneath it", async () => {
  await mutate(`mutation {
    updateDiscussions(where: { id: "sd" }, update: { hasSensitiveContent: false }) { discussions { id } }
  }`);

  assert.deepEqual(await restricted(), []);
});

test("marking an image sensitive restricts issues about it", async () => {
  const session = driver.session();
  try {
    await session.run("MATCH (i:Issue {id: 'issue'}) SET i.relatedImageId = 'img'");
  } finally {
    await session.close();
  }

  await mutate(`mutation {
    updateImages(where: { id: "img" }, update: { hasSensitiveContent: true }) { images { id } }
  }`);

  assert.ok((await restricted()).includes("issue"));
});

test("pointing an issue at marked content restricts it", async () => {
  await mutate(`mutation {
    updateIssues(where: { id: "issue" }, update: { relatedCommentId: "s-root" }) { issues { id } }
  }`);

  assert.ok((await restricted()).includes("issue"));
});

test("an explicit transaction reconciles before it commits", async () => {
  const session = driver.session();
  try {
    const tx = session.beginTransaction();
    await tx.run(`
      MATCH (parent:Comment {id: 's-root'})
      CREATE (:Comment {id: 'raw-reply', text: 'r', ageGateTouchedAt: datetime()})-[:IS_REPLY_TO]->(parent)
    `);
    await tx.commit();
  } finally {
    await session.close();
  }

  assert.ok((await restricted()).includes("raw-reply"));
});

test("a failed write rolls back its content and flags together", async () => {
  const session = driver.session();
  try {
    await assert.rejects(
      session.executeWrite(async (tx) => {
        await tx.run(`
          MATCH (parent:Comment {id: 's-root'})
          CREATE (:Comment {id: 'doomed', text: 'x', ageGateTouchedAt: datetime()})-[:IS_REPLY_TO]->(parent)
        `);
        throw new Error("boom");
      })
    );
  } finally {
    await session.close();
  }

  const check = driver.session();
  try {
    const result = await check.run("MATCH (c:Comment {id: 'doomed'}) RETURN count(c) AS n");
    assert.equal(result.records[0].get("n").toNumber(), 0);
  } finally {
    await check.close();
  }
});

test("read-only sessions are left alone", async () => {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const tx = session.beginTransaction();
    await tx.run("MATCH (n) RETURN count(n)");
    await tx.commit();
  } finally {
    await session.close();
  }

  assert.deepEqual(await restricted(), ["s-root", "sdc"]);
});
