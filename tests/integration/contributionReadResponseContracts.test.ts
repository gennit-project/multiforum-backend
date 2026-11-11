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
function execute(source: string, username: string | null = "actor", protect = false) {
  return graphql({ schema: protect ? secured : schema, source,
    contextValue: { driver, req: { headers: {} }, mayAccessSensitiveContent: false, user: username ? { username, email:null, email_verified:true, data:null } : undefined } });
}
function data(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined);
  return JSON.parse(JSON.stringify(result.data));
}


const queries={
 user:'{result:getUserContributions(username:"actor",year:2026){date count activities{type}}}',
 mod:'{result:getModContributions(displayName:"moderator",year:2026){date count}}',
 channel:'{result:getChannelContributions(channelUniqueName:"forum",year:2026){totalContributions dayData{date activities{type}}}}',
};
async function seed(){
 await driver.executeQuery(`CREATE(u:User {username:'actor'}),(mod:ModerationProfile {displayName:'moderator'}),(ch:Channel {uniqueName:'forum'}),
 (d:Discussion {id:'d',title:'Discussion',createdAt:datetime('2026-01-02T00:00:00Z')}),
 (dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum'}),
 (c:Comment {id:'c',text:'Comment',createdAt:datetime('2026-01-02T01:00:00Z')}),
 (action:ModerationAction {id:'action',createdAt:datetime('2026-01-02T00:00:00Z'),actionType:'test'})
 CREATE(u)-[:POSTED_DISCUSSION]->(d),(dc)-[:POSTED_IN_CHANNEL]->(ch),(dc)-[:POSTED_IN_CHANNEL]->(d),
 (u)-[:AUTHORED_COMMENT]->(c),(dc)-[:CONTAINS_COMMENT]->(c),(mod)-[:PERFORMED_MODERATION_ACTION]->(action)`);
}
for(const kind of ['user','mod','channel'] as const){
 test(`${kind}: computed dates and normalized counts serialize through real schema`,async()=>{
  await seed();const result=data(await execute(queries[kind])).result;
  if(kind==='channel') assert.deepEqual(result,[{totalContributions:2,dayData:[{date:'2026-01-02',activities:[{type:'activity'}]}]}]);
  else assert.deepEqual(result,[{date:'2026-01-02',count:kind==='user'?2:1,...(kind==='user'?{activities:[{type:'activity'}]}:{})}]);
  assert.deepEqual(data(await execute(queries[kind].replace('year:2026','year:2025'))).result,[]);
 });
 test(`${kind}: missing target retains wrapped error and existing empty target yields no days`,async()=>{
  const missing=await execute(queries[kind]);assert.match(missing.errors?.[0].message??'',/not found/);
  await driver.executeQuery("CREATE(:User {username:'actor'}),(:ModerationProfile {displayName:'moderator'}),(:Channel {uniqueName:'forum'})");
  assert.deepEqual(data(await execute(queries[kind])).result,[]);
 });
}
test('user and channel contributions preserve age-gated activity filtering',async()=>{
 await seed();await driver.executeQuery("MATCH(d:Discussion) SET d.hasSensitiveContent=true");
 assert.deepEqual(data(await execute(queries.user)).result,[]);assert.deepEqual(data(await execute(queries.channel)).result,[]);
});
test('moderation contribution count filters actions linked to sensitive targets',async()=>{
 await seed();await driver.executeQuery("MATCH(d:Discussion),(a:ModerationAction) SET d.hasSensitiveContent=true CREATE(i:Issue {id:'issue'})-[:TARGETS_DISCUSSION]->(d),(i)-[:ACTIVITY_ON_ISSUE]->(a)");
 assert.deepEqual(data(await execute(queries.mod)).result,[]);
});
test('date range ordering and nullable arguments retain current behavior',async()=>{
 await seed();await driver.executeQuery("MATCH(u:User) CREATE(u)-[:POSTED_DISCUSSION]->(:Discussion {id:'d2',createdAt:datetime('2026-01-03T00:00:00Z')})");
 const result=data(await execute(queries.user)).result;assert.deepEqual(result.map((d:{date:string})=>d.date),['2026-01-02','2026-01-03']);
 assert.equal(result[1].count,1);
 const ranged=queries.user.replace('year:2026','year:null,startDate:"2026-01-03",endDate:"2026-01-03"');
 assert.deepEqual(data(await execute(ranged)).result,[{date:'2026-01-03',count:1,activities:[{type:'activity'}]}]);
 data(await execute(queries.channel.replace('year:2026','year:2026,limit:null,startDate:null,endDate:null')));
});
test('nested persisted title errors remain selection dependent',async()=>{
 await seed();await driver.executeQuery("MATCH(d:Discussion) SET d.title=['invalid','text']");
 data(await execute(queries.user));data(await execute(queries.channel));
 const selected=await execute(queries.user.replace('activities{type}','activities{type Discussions{title}}'));
 assert.match(selected.errors?.[0].message??'',/String cannot represent/);
});
test('invalid dates retain query failure wrapping instead of fabricated activity defaults',async()=>{
 await seed();for(const kind of ['user','mod','channel'] as const){
  const result=await execute(queries[kind].replace('year:2026','startDate:"not-a-date",endDate:"2026-12-31"'));
  assert.match(result.errors?.[0].message??'',/Failed to fetch contributions/);
 }
});
const issues=(extra='')=>`{result:getSiteWideIssueList(isOpen:true,showOnlyServerRuleViolations:false${extra}){aggregateIssueCount}}`;
async function seedIssues(){
 await driver.executeQuery(`CREATE(u:User {username:'actor'}),(other:User {username:'other'}),
 (i:Issue {id:'own',isOpen:true,channelUniqueName:'forum',createdAt:datetime('2026-01-01'),authorName:'actor'}),
 (j:Issue {id:'other',isOpen:true,channelUniqueName:'forum',createdAt:datetime('2026-01-02'),authorName:'other'})
 CREATE(u)-[:REPORTED_ISSUE]->(i),(other)-[:REPORTED_ISSUE]->(j)`);
}
test('issue count normalization preserves zero, filtered totals and exhausted-page behavior',async()=>{
 assert.equal(data(await execute(issues())).result.aggregateIssueCount,0);await seedIssues();
 assert.equal(data(await execute(issues())).result.aggregateIssueCount,2);
 assert.equal(data(await execute(issues(',options:{limit:1}'))).result.aggregateIssueCount,2);
 assert.equal(data(await execute(issues(',options:{offset:2}'))).result.aggregateIssueCount,0);
 assert.equal(data(await execute(issues(',startDate:"2026-01-02"'))).result.aggregateIssueCount,1);
});
test('issue identity filters use current server-side viewer and anonymous matches nothing',async()=>{
 await seedIssues();
 assert.equal(data(await execute(issues(',filterCreatedByMe:true'),'actor')).result.aggregateIssueCount,1);
 assert.equal(data(await execute(issues(',filterCreatedByMe:true'),'other')).result.aggregateIssueCount,1);
 assert.equal(data(await execute(issues(',filterCreatedByMe:true'),null)).result.aggregateIssueCount,0);
});
test('issue count excludes sensitive targets and leaves malformed unselected titles alone',async()=>{
 await seedIssues();await driver.executeQuery("MATCH(i:Issue {id:'own'}) SET i.title=['invalid','text'] CREATE(i)-[:TARGETS_DISCUSSION]->(:Discussion {hasSensitiveContent:true})");
 assert.equal(data(await execute(issues())).result.aggregateIssueCount,1);
 await driver.executeQuery("MATCH(d:Discussion) SET d.hasSensitiveContent=false");
 assert.equal(data(await execute(issues())).result.aggregateIssueCount,2);
 const selected=await execute(issues().replace('{aggregateIssueCount}','{aggregateIssueCount issues{title}}'));
 assert.match(selected.errors?.[0].message??'',/String cannot represent/);
});
test('contribution and issue reads retain anonymous permission middleware behavior',async()=>{
 await seed();for(const query of [...Object.values(queries),issues()]) assert.deepEqual(data(await execute(query,null,true)),data(await execute(query,null)));
});
