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
import wikiCount from "../../customResolvers/queries/getUserWikiEditsCount.js";
import { createContributionTargetRepository } from "../../services/persistence/contributionTargetRepository.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
  secured = applyMiddleware(schema, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => resetDatabase(driver));
function execute(source: string, authenticated = true, protect = true) {
  return graphql({ schema: protect ? secured : schema, source,
    contextValue: { driver, req: { headers: {} }, user: authenticated ? { username: "actor", email: null, email_verified: true, data: null } : undefined, mayAccessSensitiveContent: false } });
}
function data(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined);
  return JSON.parse(JSON.stringify(result.data));
}
const favorites = '{ result:getUserFavoriteComment(commentId:"c") }';
const count = '{ result:getUserWikiEditsCount(username:"actor") }';
const suspended = '{ result:isOriginalPosterSuspended(issueId:"issue") }';
async function seedIssue() {
  await driver.executeQuery(`CREATE (ch:Channel {uniqueName:'forum'}), (u:User {username:'actor',isBot:false}),
    (i:Issue {id:'issue',relatedUsername:'actor'}) CREATE (ch)-[:HAS_ISSUE]->(i)`);
}
test("favorite query serializes false/true and anonymous false with permission middleware", async () => {
  await driver.executeQuery("CREATE (u:User {username:'actor'}),(c:Comment {id:'c'})");
  assert.deepEqual(data(await execute(favorites)), { result: false });
  await driver.executeQuery("MATCH(u:User),(c:Comment) CREATE (u)-[:DEFAULT_FAVORITES_COMMENTS]->(c)");
  assert.deepEqual(data(await execute(favorites)), { result: true });
  assert.deepEqual(data(await execute(favorites, false)), { result: false });
  assert.deepEqual(data(await execute('{result:getUserFavoriteComment(commentId:"missing")}')), { result: false });
});
test("favorite query age filtering hides existing favorites", async () => {
  await driver.executeQuery("CREATE (u:User {username:'actor'})-[:DEFAULT_FAVORITES_COMMENTS]->(c:Comment {id:'c'}), (dc:DiscussionChannel)-[:CONTAINS_COMMENT]->(c), (dc)-[:POSTED_IN_CHANNEL]->(:Discussion {hasSensitiveContent:true})");
  assert.deepEqual(data(await execute(favorites)), { result: false });
});
test("wiki-count serializes zero and counts only current/historical wiki edits", async () => {
  await driver.executeQuery("CREATE (:User {username:'actor'})");
  assert.deepEqual(data(await execute(count, false)), { result: 0 });
  await driver.executeQuery(`MATCH(u:User) CREATE (w:WikiPage {id:'current'}),(old:WikiPage {id:'old'}),(r:TextVersion {id:'revision'}),
    (c:Comment {id:'comment'}),(cr:TextVersion {id:'comment-revision'})
    CREATE (u)-[:AUTHORED_VERSION]->(w),(u)-[:AUTHORED_VERSION]->(r),(old)-[:HAS_VERSION]->(r),
    (u)-[:AUTHORED_VERSION]->(cr),(c)-[:HAS_VERSION]->(cr)`);
  assert.deepEqual(data(await execute(count)), { result: 2 });
  assert.deepEqual(data(await execute(count)), { result: 2 });
});
test("missing wiki-count user preserves error and non-null root bubbling", async () => {
  const result = await execute(count);
  assert.equal(result.data, null);
  assert.match(result.errors?.[0].message ?? "", /Failed to fetch wiki edits count.*not found/);
});
test("wiki-count driver failure preserves wrapped error and non-null root bubbling", async () => {
  await driver.executeQuery("CREATE (:User {username:'actor'})");
  const failingDriver = new Proxy(driver, { get(target, key) {
    if (key === "session") return (...args: Parameters<Driver["session"]>) => {
      const session = target.session(...args);
      return new Proxy(session, { get(actual, method) {
        if (method === "run") return async () => { throw new Error("injected count read"); };
        const value = Reflect.get(actual, method);
        return typeof value === "function" ? value.bind(actual) : value;
      } });
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const field = schema.getQueryType()!.getFields().getUserWikiEditsCount;
  const original = field.resolve;
  field.resolve = wikiCount({ driver: failingDriver, contributionTargetRepository: createContributionTargetRepository(driver) });
  try {
    const result = await execute(count, true, false);
    assert.equal(result.data, null);
    assert.match(result.errors?.[0].message ?? "", /Failed to fetch wiki edits count.*injected count read/);
  } finally { field.resolve = original; }
});
test("suspension query serializes false, active true and expired false", async () => {
  await seedIssue();
  assert.deepEqual(data(await execute(suspended)), { result: false });
  await driver.executeQuery(`MATCH(ch:Channel),(u:User) CREATE (s:Suspension {id:'s',username:'actor',suspendedIndefinitely:true})
    CREATE (ch)-[:SUSPENDED_AS_USER]->(s),(u)-[:SUSPENDED_AS_USER]->(s)`);
  assert.deepEqual(data(await execute(suspended)), { result: true });
  await driver.executeQuery("MATCH(s:Suspension) SET s.suspendedIndefinitely=false,s.suspendedUntil=datetime('2020-01-01T00:00:00Z')");
  assert.deepEqual(data(await execute(suspended)), { result: false });
});
test("suspension missing target preserves nullable error and sensitive target returns false", async () => {
  const absent = await execute(suspended);
  assert.equal(absent.data?.result, null);
  assert.match(absent.errors?.[0].message ?? "", /Issue not found/);
  await seedIssue();
  await driver.executeQuery("MATCH(i:Issue) CREATE (i)-[:TARGETS_DISCUSSION]->(:Discussion {hasSensitiveContent:true})");
  assert.deepEqual(data(await execute(suspended)), { result: false });
});
test("required arguments are checked by executable schema before query execution", async () => {
  for (const name of ["getUserFavoriteComment", "getUserWikiEditsCount", "isOriginalPosterSuspended"]) {
    const result = await execute(`{ ${name} }`);
    assert.equal(result.data, undefined);
    assert.match(result.errors?.[0].message ?? "", /required/);
  }
});

const pageCases = [
  { name: "getDiscussionDetailAnswers", args: 'discussionId:"d",channelUniqueName:"forum",limit:2', kind: "answer" },
  { name: "getDiscussionDetailFiles", args: 'discussionId:"d",channelUniqueName:"forum",limit:2', kind: "file" },
  { name: "getDiscussionDetailImages", args: 'discussionId:"d",channelUniqueName:"forum",limit:2', kind: "image" },
  { name: "getSiteWideDiscussionList", args: 'showArchived:false,options:{limit:2,sort:new}', kind: "discussion" },
] as const;
async function seedPages() {
  await driver.executeQuery(`CREATE (ch:Channel {uniqueName:'forum'}),(album:Album {id:'album'})
    WITH ch,album UNWIND range(1,3) AS n
    CREATE (d:Discussion {id:CASE WHEN n=1 THEN 'd' ELSE 'd'+toString(n) END,title:'Discussion',createdAt:datetime('2026-01-01T00:00:00Z')})
    CREATE (dc:DiscussionChannel {id:'dc'+toString(n),discussionId:d.id,channelUniqueName:'forum',createdAt:datetime()})
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch),(dc)-[:POSTED_IN_CHANNEL]->(d)
    WITH ch,album,collect(d)[0] AS d
    CREATE (d)-[:HAS_ALBUM]->(album)
    WITH d,album MATCH (dc:DiscussionChannel {discussionId:'d'})
    UNWIND range(1,3) AS n
    CREATE (answer:Comment {id:'answer'+toString(n),text:'Answer',createdAt:datetime('2026-01-01T00:00:00Z')})-[:IS_REPLY_TO]->(dc)
    CREATE (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'file'+toString(n),fileName:'file',createdAt:datetime('2026-01-01T00:00:00Z')})
    CREATE (album)-[:HAS_IMAGE]->(:Image {id:'image'+toString(n),url:'image',createdAt:datetime('2026-01-01T00:00:00Z')})`);
}
for (const item of pageCases) {
  function query(after?: string) {
    const args = after ? item.kind === "discussion"
      ? `showArchived:false,options:{limit:2,sort:new,after:${JSON.stringify(after)}}`
      : `${item.args},after:${JSON.stringify(after)}` : item.args;
    return `{ result:${item.name}(${args}) { pageInfo { endCursor hasNextPage } } }`;
  }
  test(`${item.name}: real-schema pageInfo covers empty, next, terminal and exhausted pages`, async () => {
    assert.deepEqual(data(await execute(query())).result.pageInfo, { endCursor: null, hasNextPage: false });
    await seedPages();
    const first = data(await execute(query())).result.pageInfo;
    assert.equal(first.hasNextPage, true);
    assert.equal(typeof first.endCursor, "string");
    const second = data(await execute(query(first.endCursor))).result.pageInfo;
    assert.equal(second.hasNextPage, false);
    assert.equal(typeof second.endCursor, "string");
    assert.notEqual(first.endCursor, second.endCursor);
    assert.deepEqual(data(await execute(query(second.endCursor))).result.pageInfo, { endCursor: null, hasNextPage: false });
  });
  test(`${item.name}: invalid cursor preserves executable-schema error`, async () => {
    const result = await execute(query("invalid"));
    assert.ok(result.errors);
    assert.equal(item.kind === "discussion" ? result.data?.result : result.data, null);
  });
}
test("raw content projections retain selection-dependent scalar errors (migration boundary evidence)", async () => {
  await driver.executeQuery("CREATE (:Channel {uniqueName:'forum',displayName:['not','a string']})");
  const countOnly = await execute('{ result:getSortedChannels(countDownloads:false) { aggregateChannelCount } }');
  assert.deepEqual(data(countOnly), { result: { aggregateChannelCount: 1 } });
  const selected = await execute('{ result:getSortedChannels(countDownloads:false) { channels { uniqueName displayName } } }');
  assert.match(selected.errors?.[0].message ?? "", /String cannot represent/);
  // An eager decoder would incorrectly fail the count-only request above.
});

test("sitewide explicit null search/lists retain wrapped errors rather than becoming empty filters", async () => {
  for (const [argument, member] of [["searchInput", "trim"], ["selectedChannels", "length"], ["selectedTags", "length"]] as const) {
    const result = await execute(`{ result:getSiteWideDiscussionList(showArchived:false,${argument}:null,options:{sort:new}) { pageInfo { hasNextPage } } }`);
    assert.equal(result.data?.result, null);
    assert.equal(result.errors?.[0].message, `Failed to fetch discussions. Cannot read properties of null (reading '${member}')`);
  }
  assert.deepEqual(data(await execute('{ result:getSiteWideDiscussionList(showArchived:null,options:{sort:top,timeFrame:null}) { pageInfo { hasNextPage endCursor } } }')).result.pageInfo, { hasNextPage: false, endCursor: null });
});
