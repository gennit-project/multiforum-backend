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
import { createContentValidationRepository } from "../../services/persistence/contentValidationRepository.js";
import { createReactionWriter } from "../../services/persistence/reactionWriter.js";
import addComment from "../../customResolvers/mutations/addEmojiToComment.js";
import removeComment from "../../customResolvers/mutations/removeEmojiFromComment.js";
import addDiscussion from "../../customResolvers/mutations/addEmojiToDiscussionChannel.js";
import removeDiscussion from "../../customResolvers/mutations/removeEmojiFromDiscussionChannel.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";
import type { ReactionMutationName } from "../../customResolvers/contracts/reactions.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
  secured = applyMiddleware(schema, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE (u:User {username:'actor',createdAt:datetime()}),
    (ch:Channel {uniqueName:'forum',createdAt:datetime()}),
    (d:Discussion {id:'d',title:'Discussion',createdAt:datetime()}),
    (dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum',emoji:'{}',createdAt:datetime()}),
    (c:Comment {id:'c',text:'Comment',isRootComment:true,isFeedbackComment:false,emoji:'{}',createdAt:datetime()})
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(d) CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
    CREATE (ch)-[:HAS_COMMENT]->(c) CREATE (u)-[:ADMIN_OF_CHANNEL]->(ch)`);
});
function execute(name: ReactionMutationName, id: string, options: { secure?: boolean; authenticated?: boolean; context?: Record<string, unknown>; username?: string } = {}) {
  const argument = name.endsWith("Comment") ? "commentId" : "discussionChannelId";
  return graphql({ schema: options.secure === false ? schema : secured,
    source: `mutation Reaction($id:ID!,$username:String!){target:${name}(${argument}:$id,username:$username,emojiLabel:"smile"${name.startsWith("add") ? ',unicode:"☺"' : ""}){id emoji}}`,
    variableValues: { id, username: options.username ?? "actor" },
    contextValue: { driver, req: { headers: {} }, user: options.authenticated === false ? undefined : { username: "actor", email: null, email_verified: true, data: null }, mayAccessSensitiveContent: false, ...options.context } });
}
const payload = JSON.stringify({ smile: { "☺": ["actor"] } });
async function stored(kind: string) {
  return (await driver.executeQuery(`MATCH(n:${kind}) RETURN n.emoji AS emoji`)).records[0].get("emoji");
}
function successful(result: Awaited<ReturnType<typeof execute>>, id: string, emoji: string) {
  assert.equal(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { target: { id, emoji } });
}
for (const [kind, id, add, remove, read, addFactory, removeFactory] of [
  ["Comment", "c", "addEmojiToComment", "removeEmojiFromComment", "findCommentEmojiState", addComment, removeComment],
  ["DiscussionChannel", "dc", "addEmojiToDiscussionChannel", "removeEmojiFromDiscussionChannel", "findDiscussionChannelEmojiState", addDiscussion, removeDiscussion],
] as const) {
  test(`${kind}: response JSON remains a string; add/remove and repeats persist exact values`, async () => {
    for (const [name, expected] of [[remove, "{}"], [add, payload], [add, payload], [remove, "{}"], [remove, "{}"]] as const) {
      successful(await execute(name, id), id, expected);
      assert.equal(await stored(kind), expected);
    }
  });
  test(`${kind}: nullable emoji and channel preferences preserve empty initialization`, async () => {
    await driver.executeQuery(`MATCH(n:${kind}) REMOVE n.emoji`);
    successful(await execute(remove, id), id, "{}");
    successful(await execute(add, id), id, payload);
  });
  test(`${kind}: missing targets throw through nullable GraphQL responses`, async () => {
    for (const name of [add, remove]) {
      const result = await execute(name, "missing", { secure: false });
      assert.equal(result.data?.target, null);
      assert.match(result.errors?.[0].message ?? "", /not found/);
    }
    assert.equal(await stored(kind), "{}");
  });
  test(`${kind}: authentication and channel authorization prevent both writes`, async () => {
    for (const name of [add, remove]) assert.ok((await execute(name, id, { authenticated: false })).errors);
    await driver.executeQuery("MATCH (:User)-[r:ADMIN_OF_CHANNEL]->() DELETE r");
    for (const name of [add, remove]) assert.ok((await execute(name, id)).errors);
    assert.equal(await stored(kind), "{}");
  });
  test(`${kind}: disabled channel and archived target block add/remove without changing stored JSON`, async () => {
    await driver.executeQuery("MATCH(ch:Channel) SET ch.emojiEnabled=false");
    for (const name of [add, remove]) assert.match((await execute(name, id)).errors?.[0].message ?? "", /disabled in channel/);
    await driver.executeQuery(`MATCH(ch:Channel),(n:${kind}) SET ch.emojiEnabled=true,n.archived=true`);
    for (const name of [add, remove]) assert.match((await execute(name, id, { secure: false })).errors?.[0].message ?? "", /archived/);
    assert.equal(await stored(kind), "{}");
  });
  test(`${kind}: malformed JSON and selected validation scalars fail before writes`, async () => {
    await driver.executeQuery(`MATCH(n:${kind}) SET n.emoji='invalid JSON'`);
    for (const name of [add, remove]) assert.ok((await execute(name, id, { secure: false })).errors);
    assert.equal(await stored(kind), "invalid JSON");
    await driver.executeQuery(`MATCH(n:${kind}) SET n.emoji='{}',n.archived='bad flag'`);
    for (const name of [add, remove]) assert.match((await execute(name, id, { secure: false })).errors?.[0].message ?? "", /Boolean cannot represent/);
    assert.equal(await stored(kind), "{}");
  });
  test(`${kind}: generated writer projection failure retains committed changes and GraphQL errors`, async () => {
    await driver.executeQuery(`MATCH(n:${kind}) REMOVE n.createdAt`);
    for (const [name, expected] of [[add, payload], [remove, "{}"]] as const) {
      const result = await execute(name, id, { secure: false });
      assert.equal(result.data?.target, null);
      assert.match(result.errors?.[0].message ?? "", /Cannot return null for non-nullable field .*createdAt/);
      assert.equal(await stored(kind), expected);
    }
  });
  test(`${kind}: injected validation-read and writer failures retain errors without writes`, async () => {
    const repository = createContentValidationRepository(driver);
    for (const [name, factory] of [[add, addFactory], [remove, removeFactory]] as const) {
      const readResult = await execute(name, id, { secure: false, context: { contentValidationRepository: { ...repository, [read]: async () => { throw new Error("injected validation read"); } } } });
      assert.equal(readResult.data?.target, null);
      assert.match(readResult.errors?.[0].message ?? "", /injected validation read/);
      const field = schema.getMutationType()!.getFields()[name];
      const original = field.resolve;
      const fail = async () => { throw new Error("injected reaction write"); };
      field.resolve = factory({ reactionWriter: { ...createReactionWriter(driver), updateCommentEmoji: fail, updateDiscussionChannelEmoji: fail } });
      try {
        const result = await execute(name, id, { secure: false });
        assert.equal(result.data?.target, null);
        assert.match(result.errors?.[0].message ?? "", /injected reaction write/);
      } finally { field.resolve = original; }
      assert.equal(await stored(kind), "{}");
    }
  });
}
test("discussion lock freezes both discussion and nested comment reactions", async () => {
  await driver.executeQuery("MATCH(c:Comment),(dc:DiscussionChannel) CREATE (dc)-[:CONTAINS_COMMENT]->(c) SET dc.locked=true");
  for (const name of ["addEmojiToComment", "removeEmojiFromComment", "addEmojiToDiscussionChannel", "removeEmojiFromDiscussionChannel"] as const) {
    assert.match((await execute(name, name.endsWith("Comment") ? "c" : "dc", { secure: false })).errors?.[0].message ?? "", /locked/);
  }
  assert.equal(await stored("Comment"), "{}"); assert.equal(await stored("DiscussionChannel"), "{}");
});
