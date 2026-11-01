import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createCommentVoteRepository } from "../../services/persistence/commentVoteRepository.js";
import { createDiscussionChannelVoteRepository } from "../../services/persistence/discussionChannelVoteRepository.js";
import upvoteComment from "../../customResolvers/mutations/upvoteComment.js";
import undoUpvoteComment from "../../customResolvers/mutations/undoUpvoteComment.js";
import upvoteDiscussionChannel from "../../customResolvers/mutations/upvoteDiscussionChannel.js";
import undoUpvoteDiscussionChannel from "../../customResolvers/mutations/undoUpvoteDiscussionChannel.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";
import type { VotingMutationName } from "../../customResolvers/contracts/voting.js";

let driver: Driver, schema: GraphQLSchema, protectedSchema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
  protectedSchema = applyMiddleware(schema, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE (a:User {username:'author',createdAt:datetime(),commentKarma:5,discussionKarma:7}),
    (v:User {username:'voter',createdAt:datetime(),commentKarma:0,discussionKarma:0}),
    (ch:Channel {uniqueName:'forum',createdAt:datetime()}),
    (d:Discussion {id:'d',title:'Discussion',createdAt:datetime()}),
    (dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum',weightedVotesCount:0,createdAt:datetime()}),
    (c:Comment {id:'c',text:'Comment',isRootComment:true,weightedVotesCount:0,createdAt:datetime()})
    CREATE (a)-[:POSTED_DISCUSSION]->(d) CREATE (a)-[:AUTHORED_COMMENT]->(c)
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(d) CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
    CREATE (ch)-[:HAS_COMMENT]->(c) CREATE (v)-[:ADMIN_OF_CHANNEL]->(ch)`);
});
const fields = `id weightedVotesCount UpvotedByUsers { username }
  UpvotedByUsersConnection { totalCount aggregate { count { nodes } } }`;
function execute(name: VotingMutationName, id: string, secure = false, authenticated = true) {
  const argument = name.endsWith("Comment") ? "commentId" : "discussionChannelId";
  return graphql({ schema: secure ? protectedSchema : schema,
    source: `mutation Vote($id:ID!,$username:String!){vote:${name}(${argument}:$id,username:$username){${fields}}}`,
    variableValues: { id, username: "voter" },
    contextValue: { driver, req: { headers: {} }, user: authenticated ? { username: "voter", email: null, email_verified: true, data: null } : undefined, mayAccessSensitiveContent: false } });
}
function expected(id: string, count: number) {
  return { vote: { id, weightedVotesCount: count, UpvotedByUsers: count ? [{ username: "voter" }] : [],
    UpvotedByUsersConnection: { totalCount: count, aggregate: { count: { nodes: count } } } } };
}
async function state(kind: "Comment" | "DiscussionChannel") {
  const relationship = kind === "Comment" ? "UPVOTED_COMMENT" : "UPVOTED_DISCUSSION";
  const karma = kind === "Comment" ? "commentKarma" : "discussionKarma";
  const row = (await driver.executeQuery(`MATCH (n:${kind}),(a:User {username:'author'})
    OPTIONAL MATCH (:User)-[r:${relationship}]->(n)
    RETURN n.weightedVotesCount AS weight,count(r) AS votes,a.${karma} AS karma`)).records[0];
  return { weight: Number(row.get("weight")), votes: Number(row.get("votes")), karma: Number(row.get("karma")) };
}
for (const [kind, id, up, undo, initialKarma] of [
  ["Comment", "c", "upvoteComment", "undoUpvoteComment", 5],
  ["DiscussionChannel", "dc", "upvoteDiscussionChannel", "undoUpvoteDiscussionChannel", 7],
] as const) {
  test(`${kind}: real GraphQL serializes vote/undo counts, connections and zero votes with permissions`, async () => {
    const added = await execute(up, id, true);
    assert.equal(added.errors, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(added.data)), expected(id, 1));
    assert.deepEqual(await state(kind), { weight: 1, votes: 1, karma: initialKarma + 1 });
    const repeated = await execute(up, id, true);
    assert.equal(repeated.errors, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(repeated.data)), { vote: null });
    assert.deepEqual(await state(kind), { weight: 1, votes: 1, karma: initialKarma + 1 });
    const removed = await execute(undo, id, true);
    assert.equal(removed.errors, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(removed.data)), expected(id, 0));
    assert.deepEqual(await state(kind), { weight: 0, votes: 0, karma: initialKarma });
    const repeatedUndo = await execute(undo, id);
    assert.deepEqual(JSON.parse(JSON.stringify(repeatedUndo.data)), { vote: null });
    assert.equal(Boolean(repeatedUndo.errors), kind === "Comment");
  });
  test(`${kind}: nullable missing results preserve existing error asymmetry`, async () => {
    for (const name of [up, undo]) {
      const result = await execute(name, "missing");
      assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { vote: null });
      assert.equal(Boolean(result.errors), name === "undoUpvoteComment");
    }
  });
  test(`${kind}: anonymous callers cannot vote or undo through permission middleware`, async () => {
    for (const name of [up, undo]) assert.ok((await execute(name, id, true, false)).errors);
    assert.deepEqual(await state(kind), { weight: 0, votes: 0, karma: initialKarma });
  });
  test(`${kind}: authenticated callers without channel permission cannot vote or undo`, async () => {
    await driver.executeQuery("MATCH (:User {username:'voter'})-[r:ADMIN_OF_CHANNEL]->(:Channel) DELETE r");
    for (const name of [up, undo]) assert.ok((await execute(name, id, true)).errors);
    assert.deepEqual(await state(kind), { weight: 0, votes: 0, karma: initialKarma });
  });
  test(`${kind}: missing voter yields the existing nullable upvote result`, async () => {
    await driver.executeQuery("MATCH (u:User {username:'voter'}) DETACH DELETE u");
    const result = await execute(up, id);
    assert.equal(result.errors, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { vote: null });
    assert.deepEqual(await state(kind), { weight: 0, votes: 0, karma: initialKarma });
  });
  for (const name of [up, undo]) test(`${name}: repository failure serializes nullable result, preserves throws and rolls back vote`, async () => {
    if (name === undo) assert.equal((await execute(up, id)).errors, undefined);
    const beforeState = await state(kind);
    const fail = async () => { throw new Error("injected vote repository failure"); };
    const commentRepo = { ...createCommentVoteRepository(driver), setAuthorKarma: fail };
    const discussionRepo = { ...createDiscussionChannelVoteRepository(driver), setAuthorKarma: fail };
    const replacements = {
      upvoteComment: upvoteComment({ driver, repository: commentRepo }),
      undoUpvoteComment: undoUpvoteComment({ driver, repository: commentRepo }),
      upvoteDiscussionChannel: upvoteDiscussionChannel({ driver, repository: discussionRepo }),
      undoUpvoteDiscussionChannel: undoUpvoteDiscussionChannel({ driver, repository: discussionRepo }),
    };
    const field = schema.getMutationType()!.getFields()[name];
    const previous = field.resolve;
    field.resolve = replacements[name];
    try {
      const result = await execute(name, id);
      assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { vote: null });
      assert.equal(Boolean(result.errors), name === "undoUpvoteComment");
      if (result.errors) assert.match(result.errors[0].message, /injected vote repository failure/);
      assert.deepEqual(await state(kind), beforeState);
    } finally { field.resolve = previous; }
  });
}

test("GraphQL still enforces selected non-null connection counts at runtime", async () => {
  const field = schema.getMutationType()!.getFields().upvoteComment;
  const previous = field.resolve;
  field.resolve = () => ({ id: "c", weightedVotesCount: 0, UpvotedByUsers: [], UpvotedByUsersConnection: { totalCount: null, aggregate: { count: { nodes: 0 } } } });
  try {
    const result = await execute("upvoteComment", "c");
    assert.ok(result.errors?.some((e) => e.message.includes("totalCount")));
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { vote: null });
  } finally { field.resolve = previous; }
});

test("nullable selected scalar values are valid responses, not contract violations", async () => {
  const field = schema.getMutationType()!.getFields().upvoteComment;
  const previous = field.resolve;
  field.resolve = () => ({ ...expected("c", 0).vote, weightedVotesCount: null });
  try {
    const result = await execute("upvoteComment", "c");
    assert.equal(result.errors, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { vote: { ...expected("c", 0).vote, weightedVotesCount: null } });
  } finally { field.resolve = previous; }
});
