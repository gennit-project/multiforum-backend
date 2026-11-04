import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { graphql, type GraphQLSchema } from "graphql";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { applyMiddleware } from "graphql-middleware";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import getResolvers from "../helpers/getTestResolvers.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { provisionServerDefaults } from "../../seedData/provisionServerDefaults.js";
import { createServerDefaultsRepository } from "../../services/persistence/serverDefaultsRepository.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver;
let schema: GraphQLSchema;
before(async () => {
  process.env.E2E_MOCK_AUTH = "true";
  process.env.SERVER_CONFIG_NAME = "scratchpad-author-contract";
  driver = await startNeo4j();
  const generated = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers }).getSchema();
  registerGeneratedSchema(driver, generated);
  schema = applyMiddleware(generated, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE(s:ServerConfig{serverName:'scratchpad-author-contract'})
    CREATE(a:User{username:'alice',createdAt:datetime(),commentKarma:0}),
      (b:User{username:'bob',createdAt:datetime(),commentKarma:0}),
      (m:ModerationProfile{displayName:'Moderator'}),
      (ch:Channel{uniqueName:'forum',createdAt:datetime()}),
      (r:ChannelRole{canUpvoteComment:true}),
      (c:Comment{id:'comment',text:'comment text',createdAt:datetime(),weightedVotesCount:0}),
      (dc:DiscussionChannel{id:'post',discussionId:'discussion',channelUniqueName:'forum',createdAt:datetime()})
    CREATE(ch)-[:HAS_DEFAULT_CHANNEL_ROLE]->(r),
      (a)-[:UPVOTED_COMMENT]->(c),(m)-[:AUTHORED_COMMENT]->(c),
      (dc)-[:CONTAINS_COMMENT]->(c),(dc)-[:POSTED_IN_CHANNEL]->(ch)`);
  await provisionServerDefaults({ repository: createServerDefaultsRepository(driver), serverName: "scratchpad-author-contract" });
});
const source = `mutation {
  result:createScratchpadEntry(recipientUsername:"bob",text:"Thanks!",sourceType:"comment",sourceId:"comment") {
    id text isPublic sourceType sourceId
    author:Author { username }
    recipient:Recipient { username }
    voters:superUpvotedByUsers { username }
  }
}`;
const execute = (username: string | null = "alice") => graphql({
  schema, source,
  contextValue: { driver, req: { headers: username ? {
    authorization: `Bearer ${jwt.sign({ username, email: `${username}@example.test`, email_verified: true }, "test-only-key")}`,
  } : {}, body: {}, isMutation: true } },
});
async function state() {
  const row = (await driver.executeQuery(`MATCH(c:Comment{id:'comment'})
    RETURN c.weightedVotesCount AS weight,
      COUNT {(:ScratchpadEntry)} AS entries,
      COUNT {(:User)-[:SUPER_UPVOTED_COMMENT]->(c)} AS votes,
      COUNT {(:User{username:'bob'})-[:HAS_NOTIFICATION]->(:Notification)} AS recipientNotifications,
      COUNT {(:Notification{notificationType:'scratchpad'})} AS notifications,
      COLLECT { MATCH(u:User) RETURN {username:u.username,karma:u.commentKarma} } AS karma`)).records[0];
  return { weight: Number(row.get("weight")), entries: Number(row.get("entries")), votes: Number(row.get("votes")),
    recipientNotifications: Number(row.get("recipientNotifications")), notifications: Number(row.get("notifications")),
    karma: row.get("karma").map((u: {username: string; karma: unknown}) => ({username:u.username,karma:Number(u.karma)})).sort((a: {username:string},b: {username:string})=>a.username.localeCompare(b.username)) };
}
test("moderator-author super-upvote serializes, notifies the selected recipient and awards no user karma", async () => {
  const result = await execute();
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.ok(result.data?.result);
  const value = JSON.parse(JSON.stringify(result.data)).result;
  assert.equal(typeof value.id, "string");
  assert.deepEqual({...value,id:null}, {id:null,text:"Thanks!",isPublic:false,sourceType:"comment",sourceId:"comment",author:{username:"alice"},recipient:{username:"bob"},voters:[{username:"alice"}]});
  assert.deepEqual(await state(), {weight:1,entries:1,votes:1,recipientNotifications:1,notifications:1,karma:[{username:"alice",karma:0},{username:"bob",karma:0}]});
  assert.ok((await execute()).errors, "repeat operations must still fail");
  assert.equal((await state()).entries, 1);
});
test("User-author control retains karma and notification behavior", async () => {
  await driver.executeQuery("MATCH(:ModerationProfile)-[r:AUTHORED_COMMENT]->(c:Comment),(u:User{username:'bob'}) DELETE r CREATE(u)-[:AUTHORED_COMMENT]->(c)");
  assert.equal((await execute()).errors, undefined);
  assert.deepEqual((await state()).karma, [{username:"alice",karma:0},{username:"bob",karma:1}]);
  assert.equal((await state()).recipientNotifications, 1);
});
test("anonymous callers and users without channel permission cannot create moderator-author entries", async () => {
  assert.ok((await execute(null)).errors);
  await driver.executeQuery("MATCH(r:ChannelRole) SET r.canUpvoteComment=false");
  assert.ok((await execute()).errors);
  assert.equal((await state()).entries, 0);
  assert.equal((await state()).notifications, 0);
  assert.equal((await state()).votes, 0);
});
test("a normal upvote remains required even for a moderator-author source", async () => {
  await driver.executeQuery("MATCH(:User)-[r:UPVOTED_COMMENT]->(:Comment) DELETE r");
  assert.ok((await execute()).errors);
  assert.equal((await state()).entries, 0);
  assert.equal((await state()).votes, 0);
  assert.equal((await state()).notifications, 0);
});

for (const sourceType of ["comment", "discussion"] as const) {
  test(`${sourceType}: super-vote authorization follows the source on create and undo`, async () => {
    await driver.executeQuery(`MATCH(a:User{username:'alice'}),(b:User{username:'bob'}),(dc:DiscussionChannel{id:'post'})
      CREATE(d:Discussion{id:'discussion',title:'Discussion',createdAt:datetime()})
      CREATE(dc)-[:POSTED_IN_CHANNEL]->(d),(b)-[:POSTED_DISCUSSION]->(d),(a)-[:UPVOTED_DISCUSSION]->(dc)
      CREATE(ch:Channel{uniqueName:'other-forum',createdAt:datetime()}),(r:ChannelRole{canUpvoteComment:true,canUpvoteDiscussion:true})
      CREATE(ch)-[:HAS_DEFAULT_CHANNEL_ROLE]->(r)`);
    const id = sourceType === "comment" ? "comment" : "post";
    const create = `mutation{createScratchpadEntry(recipientUsername:"bob",text:"Thanks",sourceType:"${sourceType}",sourceId:"${id}",sourceChannelUniqueName:"other-forum"){id}}`;
    const undo = `mutation{undoSuperUpvote(sourceType:"${sourceType}",sourceId:"${id}"){success message}}`;
    const invoke = (operation: string) => graphql({schema,source:operation,contextValue:{driver,req:{headers:{authorization:`Bearer ${jwt.sign({username:"alice",email:"alice@example.test",email_verified:true},"test-only-key")}`},body:{},isMutation:true}}});
    const setPermission = (allow: boolean) => driver.executeQuery("MATCH(:Channel{uniqueName:'forum'})-[:HAS_DEFAULT_CHANNEL_ROLE]->(r:ChannelRole) SET r.canUpvoteComment=$allow,r.canUpvoteDiscussion=$allow",{allow});
    const snapshot = async () => (await driver.executeQuery(`RETURN COUNT {(:ScratchpadEntry)} AS entries,
      COUNT {(:User)-[:SUPER_UPVOTED_COMMENT|SUPER_UPVOTED_DISCUSSION]->()} AS votes,
      COUNT {(:Notification{notificationType:'scratchpad'})} AS notifications,
      COLLECT { MATCH(n) WHERE n:Comment OR n:DiscussionChannel RETURN {id:n.id,weight:n.weightedVotesCount} ORDER BY n.id } AS weights,
      COLLECT { MATCH(u:User) RETURN {username:u.username,karma:u.commentKarma,discussionKarma:u.discussionKarma} ORDER BY u.username } AS karma`)).records[0].toObject();
    await setPermission(false);
    const empty = await snapshot();
    assert.ok((await invoke(create)).errors, "a different permitted channel must not authorize the source");
    assert.deepEqual(await snapshot(),empty);
    await setPermission(true);
    await driver.executeQuery("MATCH(ch:Channel{uniqueName:'forum'}) CREATE(ch)-[:SUSPENDED_AS_USER]->(:Suspension{id:'active-source-suspension',username:'alice',suspendedIndefinitely:true})");
    assert.ok((await invoke(create)).errors, "source suspension remains enforced");
    assert.deepEqual(await snapshot(),empty);
    await driver.executeQuery("MATCH(s:Suspension{id:'active-source-suspension'}) DETACH DELETE s");
    assert.equal((await invoke(create)).errors,undefined, "an authorized source remains supported with the optional hint");
    await setPermission(false);
    const created = await snapshot();
    assert.ok((await invoke(undo)).errors, "undo must check the source permission too");
    assert.deepEqual(await snapshot(),created);
    await setPermission(true);
    assert.equal((await invoke(undo)).errors,undefined);
  });
}
