import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
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
import { createChannelModerationRepository } from "../../services/persistence/channelModerationRepository.js";
import { createIssueLockRepository } from "../../services/persistence/issueLockRepository.js";
import lockChannel from "../../customResolvers/mutations/lockChannel.js";
import unlockChannel from "../../customResolvers/mutations/unlockChannel.js";
import lockIssue from "../../customResolvers/mutations/lockIssue.js";
import unlockIssue from "../../customResolvers/mutations/unlockIssue.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver:Driver,schema:GraphQLSchema,secured:GraphQLSchema;
let failure:""|"action"|"state"|"notify"="";
let corruptChannel=false;
const calls:string[]=[];
before(async()=>{
 driver=await startNeo4j();
 const channels=createChannelModerationRepository(driver),issues=createIssueLockRepository(driver);
 const channelRepository={...channels,recordAction:async(input:Parameters<typeof channels.recordAction>[0])=>{calls.push("action");if(failure==="action")throw Error("injected action failure");return channels.recordAction(input);},updateLockState:async(input:Parameters<typeof channels.updateLockState>[0])=>{calls.push("state");if(failure==="state")throw Error("injected state failure");if(corruptChannel)await driver.executeQuery("MATCH(c:Channel {uniqueName:'forum'}) SET c.displayName=['bad']");return channels.updateLockState(input);}};
 const notifySubscribers=async()=>{calls.push("notify");if(failure==="notify")throw Error("injected notification failure");return true;};
 const app=getResolvers(driver);
 schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,Mutation:{...app.resolvers.Mutation,
 lockChannel:lockChannel({driver,channelModerationRepository:channelRepository}),unlockChannel:unlockChannel({driver,channelModerationRepository:channelRepository}),
 lockIssue:lockIssue({issueLockRepository:issues,notifySubscribers}),unlockIssue:unlockIssue({issueLockRepository:issues,notifySubscribers})}},features:{filters:{String:{MATCHES:true}}}}).getSchema();
 registerGeneratedSchema(driver,schema);schema=applyMiddleware(schema,sourceIdentity);secured=applyMiddleware(schema,permissions);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 await resetDatabase(driver);failure="";corruptChannel=false;calls.length=0;
 await driver.executeQuery(`CREATE(u:User {username:'actor',createdAt:datetime()}),(m:ModerationProfile {displayName:'ActorMod',createdAt:datetime()}),
 (ch:Channel {uniqueName:'forum',displayName:'Forum',locked:false,createdAt:datetime()}),
 (i:Issue {id:'i',issueNumber:1,title:'Issue',body:'Body',isOpen:true,locked:false,relatedChannelUniqueName:'forum',createdAt:datetime()})
 CREATE(u)-[:MODERATION_PROFILE]->(m) CREATE(u)-[:ADMIN_OF_CHANNEL]->(ch)`);
});
function execute(source:string,authenticated=true,secure=false){return graphql({schema:secure?secured:schema,source:`mutation {${source}}`,contextValue:{driver,req:{headers:{}},user:authenticated?{username:'actor',email:null,email_verified:true,data:{ModerationProfile:{displayName:'ActorMod'}}}:undefined}});}
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const channelFields="uniqueName locked lockedAt lockReason";
const issueFields="id locked lockedAt lockReason";
async function locked(label:"Issue"|"Channel"){return (await driver.executeQuery(`MATCH(n:${label}) RETURN n.locked AS locked`)).records[0].get('locked');}
for(const kind of ['Channel','Issue'] as const){
 const arg=kind==='Channel'?'channelUniqueName:"forum"':'issueId:"i"';
 const fields=kind==='Channel'?channelFields:issueFields;
 test(`${kind} lock/unlock complete proven state, retain raw reason and repeated-state errors`,async()=>{
  const result=await execute(`lock${kind}(${arg},reason:" raw reason "){${fields}}`);assert.equal(result.errors,undefined);
  const output=plain(result.data)[`lock${kind}`];assert.equal(output.locked,true);assert.equal(output.lockReason," raw reason ");assert.match(output.lockedAt,/^\d{4}-/);assert.equal(await locked(kind),true);
  assert.match((await execute(`lock${kind}(${arg},reason:"r"){${fields}}`)).errors?.[0].message??'',/already locked/);
  const undone=await execute(`unlock${kind}(${arg},reason:null){${fields}}`);assert.equal(undone.errors,undefined);
  assert.deepEqual(plain(undone.data)[`unlock${kind}`],{[kind==='Channel'?'uniqueName':'id']:kind==='Channel'?'forum':'i',locked:false,lockedAt:null,lockReason:null});assert.equal(await locked(kind),false);
  assert.match((await execute(`unlock${kind}(${arg}){${fields}}`)).errors?.[0].message??'',/not locked/);
 });
 test(`${kind} missing target and anonymous requests fail before state writes`,async()=>{
  const missing=kind==='Channel'?'channelUniqueName:"missing"':'issueId:"missing"';
  assert.match((await execute(`lock${kind}(${missing},reason:"r"){${fields}}`)).errors?.[0].message??'',/not found/);
  assert.ok((await execute(`lock${kind}(${arg},reason:"r"){${fields}}`,false,true)).errors);
  assert.equal(await locked(kind),false);assert.deepEqual(calls,[]);
 });
}
test('issue raw body stays lazy: narrow lock succeeds, selected malformed body fails after durable unlock',async()=>{
 await driver.executeQuery("MATCH(i:Issue) SET i.body=['bad']");
 assert.equal((await execute(`lockIssue(issueId:"i",reason:"r"){${issueFields}}`)).errors,undefined);
 const result=await execute(`unlockIssue(issueId:"i"){${issueFields} body}`);assert.match(result.errors?.[0].message??'',/String cannot represent/);assert.deepEqual(result.errors?.[0].path,['unlockIssue','body']);assert.equal(await locked('Issue'),false);assert.deepEqual(calls,['notify','notify']);
});
test('channel raw name remains lazy if changed after validated preliminary read',async()=>{
 corruptChannel=true;
 const narrow=await execute(`lockChannel(channelUniqueName:"forum",reason:"r"){${channelFields}}`);assert.equal(narrow.errors,undefined);assert.equal(await locked('Channel'),true);
 // Reset the preliminary read field, then corrupt it only at the write boundary again.
 await driver.executeQuery("MATCH(c:Channel) SET c.displayName='Forum'");
 const selected=await execute(`unlockChannel(channelUniqueName:"forum"){${channelFields} displayName}`);assert.match(selected.errors?.[0].message??'',/String cannot represent/);assert.deepEqual(selected.errors?.[0].path,['unlockChannel','displayName']);assert.equal(await locked('Channel'),false);
});
test('channel action failure stays swallowed before lock-state write; state failure keeps prior action',async()=>{
 failure='action';assert.equal((await execute(`lockChannel(channelUniqueName:"forum",reason:"r"){${channelFields}}`)).errors,undefined);assert.deepEqual(calls,['action','state']);assert.equal(await locked('Channel'),true);
 failure='state';calls.length=0;const result=await execute(`unlockChannel(channelUniqueName:"forum"){${channelFields}}`);assert.match(result.errors?.[0].message??'',/Error unlocking channel/);assert.deepEqual(calls,['action','state']);assert.equal(await locked('Channel'),true);
 const actionCount=(await driver.executeQuery("MATCH(a:ModerationAction) RETURN count(a) AS count")).records[0].get('count').toNumber();assert.equal(actionCount,1);
});
test('issue notification failure retains committed lock and resolver error wrapper',async()=>{
 failure='notify';const result=await execute(`lockIssue(issueId:"i",reason:"r"){${issueFields}}`);assert.match(result.errors?.[0].message??'',/^Error locking issue$/);assert.equal(await locked('Issue'),true);assert.deepEqual(calls,['notify']);
});

test('issue lock and unlock preserve canonical native property names',async()=>{
 for(const source of ['lockIssue(issueId:"i",reason:"r"){id title:id}','unlockIssue(issueId:"i"){id title:id}']){
  const result=await execute(source);assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const row=plain(result.data)[Object.keys(plain(result.data))[0]];assert.equal(row.title,row.id);
 }
});
