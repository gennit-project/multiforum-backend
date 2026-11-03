import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";
let driver: Driver, schema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = applyMiddleware(await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers }).getSchema(), permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE (c:Channel {uniqueName:'bots',createdAt:datetime()}),
    (:Channel {uniqueName:'empty',createdAt:datetime()}), (u:User {username:'bot',createdAt:datetime()}),
    (m:ModerationProfile {displayName:'Moderator',createdAt:datetime()})
    CREATE (c)-[:BOT]->(u), (u)-[:MODERATION_PROFILE]->(m)
    WITH u,m UNWIND [{id:'active',channelUniqueName:'bots',suspendedUntil:datetime('2099-01-01')},
      {id:'expired',channelUniqueName:'bots',suspendedUntil:datetime('2000-01-01')},
      {id:'indefinite',channelUniqueName:'bots',suspendedIndefinitely:true},
      {id:'other-forum',channelUniqueName:'other',suspendedIndefinitely:true}] AS props
    CREATE (s:Suspension) SET s=props,s.createdAt=datetime()
    CREATE (u)-[:SUSPENDED_AS_USER]->(s), (m)-[:SUSPENDED_AS_MOD]->(s)`);
});
const exec = (source: string) => graphql({ schema, source, contextValue: { driver, req: { headers: {} } } });
const connection = `SuspensionsConnection(where:{node:{channelUniqueName:{eq:"bots"},OR:[{suspendedIndefinitely:{eq:true}},{suspendedUntil:{gt:"2026-01-01T00:00:00Z"}}]}}){aggregate{count{nodes}}}`;
test("anonymous getChannel bot suspension counts and empty forums remain readable through shield", async () => {
  const result = await exec(`query getChannel { channels(sort:[{uniqueName:ASC}]){uniqueName Bots{username ${connection}}} }`);
  assert.equal(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { channels: [
    { uniqueName: "bots", Bots: [{ username: "bot", SuspensionsConnection: { aggregate: { count: { nodes: 2 } } } }] },
    { uniqueName: "empty", Bots: [] },
  ] });
});
test("public moderator suspension aggregate does not expose the private moderator identity edge", async () => {
  const publicRead = await exec(`{ moderationProfiles{displayName ${connection}} }`);
  assert.equal(publicRead.errors, undefined);
  assert.equal(JSON.parse(JSON.stringify(publicRead.data)).moderationProfiles[0].SuspensionsConnection.aggregate.count.nodes, 2);
  const privateRead = await exec("{ moderationProfiles{displayName User{username}} }");
  assert.ok(privateRead.errors);
  assert.ok(privateRead.errors.some(error => error.path?.includes("User")));
});

test("bot lists preserve aliased and fragment-selected counts without requiring unrequested scalar fields", async () => {
  await driver.executeQuery("MATCH(u:User {username:'bot'}) SET u.displayName=['malformed']");
  const result=await exec(`query getChannel { forums:channels(sort:[{uniqueName:ASC}]){ key:uniqueName ...BotList } }
    fragment BotList on Channel { Bots { name:username ...Counts } }
    fragment Counts on User { ${connection.replace('SuspensionsConnection','active:SuspensionsConnection')} }`);
  assert.equal(result.errors,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{forums:[
    {key:'bots',Bots:[{name:'bot',active:{aggregate:{count:{nodes:2}}}}]},
    {key:'empty',Bots:[]},
  ]});
  const selected=await exec('{forums:channels(where:{uniqueName:{eq:"bots"}}){Bots{name:username bad:displayName}}}');
  assert.ok(selected.errors?.some(error=>JSON.stringify(error.path)===JSON.stringify(['forums',0,'Bots',0,'bad'])));
  assert.equal(JSON.parse(JSON.stringify(selected.data)).forums[0].Bots[0].bad,null);
});

test("aliased private identity fields remain denied and skipped fields remain unrequested", async () => {
  const requested=await exec(`query { profiles:moderationProfiles { name:displayName ...PrivateIdentity } }
    fragment PrivateIdentity on ModerationProfile { identity:User { username } }`);
  assert.ok(requested.errors?.some(error=>error.path?.includes('identity')));
  assert.equal(JSON.parse(JSON.stringify(requested.data)).profiles[0].identity,null);
  const skipped=await graphql({schema,source:`query($hide:Boolean!){profiles:moderationProfiles{name:displayName ...PrivateIdentity @skip(if:$hide)}}
    fragment PrivateIdentity on ModerationProfile{identity:User{username}}`,variableValues:{hide:true},contextValue:{driver,req:{headers:{}}}});
  assert.equal(skipped.errors,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(skipped.data)),{profiles:[{name:'Moderator'}]});
});


test("aliased bot lists retain the generated response-key projection", async () => {
  const plain=await exec('{channels(where:{uniqueName:{eq:"bots"}}){Bots{username}}}');
  assert.equal(plain.errors,undefined);
  assert.equal(JSON.parse(JSON.stringify(plain.data)).channels[0].Bots.length,1);
  const aliased=await exec('query { forums:channels(where:{uniqueName:{eq:"bots"}}){...BotAlias} } fragment BotAlias on Channel{members:Bots{username}}');
  assert.equal(aliased.errors,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(aliased.data)),{forums:[{members:[{username:"bot"}]}]});
});

test('plain and aliased bot selections keep independent filters and directives', async () => {
  const result = await graphql({schema,source:`query($show:Boolean!){
    channels(where:{uniqueName:{eq:"bots"}}){
      Bots{username}
      members:Bots(where:{username:{eq:"bot"}}){username}
      missing:Bots(where:{username:{eq:"missing"}}){username}
      skipped:Bots @skip(if:$show){username}
    }
  }`,variableValues:{show:true},contextValue:{driver,req:{headers:{}}}});
  assert.equal(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {channels:[{
    Bots:[{username:'bot'}],members:[{username:'bot'}],missing:[],
  }]});
});
