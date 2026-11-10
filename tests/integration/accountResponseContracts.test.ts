import sourceIdentity from "../../middleware/userChildIdentityMiddleware.js";
import { denyImageExternalIo } from "../denyImageExternalIo.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, afterEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createEmailNotificationRepository } from "../../services/persistence/emailNotificationRepository.js";
import { createInstancePolicyRepository } from "../../services/persistence/instancePolicyRepository.js";
import setProfileImage from "../../customResolvers/mutations/setProfileImage.js";
import setChannelIcon from "../../customResolvers/mutations/setChannelIcon.js";
import getSetup from "../../customResolvers/queries/getInstanceSetupStatus.js";
import inviteForumMod from "../../customResolvers/mutations/inviteForumMod.js";
import inviteForumOwner from "../../customResolvers/mutations/inviteForumOwner.js";
import inviteServerMod from "../../customResolvers/mutations/inviteServerMod.js";
import inviteServerAdmin from "../../customResolvers/mutations/inviteServerAdmin.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
let ioGuard: ReturnType<typeof denyImageExternalIo>;
let mailResult = true;
let includeVariants = true;
before(async () => {
  driver = await startNeo4j();
  const app = getResolvers(driver);
  const generateVariants = async () => ({ variantUrls: includeVariants ? { avatar32: "https://example.test/avatar32" } : {}, variantStorageObjectNames: {} });
  app.resolvers.Mutation.setProfileImage = setProfileImage({driver, generateVariants});
  app.resolvers.Mutation.setChannelIcon = setChannelIcon({driver, generateVariants});
  const emailDelivery = { emailNotificationRepository: createEmailNotificationRepository(driver), sendMail: async () => mailResult };
  app.resolvers.Mutation.inviteForumMod = inviteForumMod({ driver, emailDelivery });
  app.resolvers.Mutation.inviteForumOwner = inviteForumOwner({ driver, emailDelivery });
  app.resolvers.Mutation.inviteServerMod = inviteServerMod({ driver, emailDelivery });
  app.resolvers.Mutation.inviteServerAdmin = inviteServerAdmin({ driver, emailDelivery });
  // Deterministic capability view; never inspect the runner's configured secrets.
  app.resolvers.Query.getInstanceSetupStatus = getSetup({ instancePolicyRepository: createInstancePolicyRepository(driver), env: { SERVER_CONFIG_NAME: "forum" } });
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
  secured = applyMiddleware(schema, permissions, sourceIdentity);
  schema = applyMiddleware(schema, sourceIdentity);
  ioGuard = denyImageExternalIo();
}, { timeout: 240000 });
afterEach(() => ioGuard?.assertUnused());
after(async () => { ioGuard?.restore(); await stopNeo4j(); });
beforeEach(async () => {
  await resetDatabase(driver); mailResult = true; includeVariants = true;
  await driver.executeQuery(`CREATE (u:User {username:'actor',createdAt:datetime()}),
    (e:Email {address:'actor@example.test'}), (p:ModerationProfile {displayName:'Actor Mod'}),
    (ch:Channel {uniqueName:'forum',createdAt:datetime()}),
    (s:ServerConfig {serverName:'forum'}), (d:Discussion {id:'discussion',title:'Title',createdAt:datetime()}),
    (co:Collection {id:'collection',name:'Collection',visibility:'PUBLIC',collectionType:'DISCUSSIONS',itemCount:0,shareCount:0,itemOrder:[],createdAt:datetime(),updatedAt:datetime()})
    CREATE (e)-[:HAS_EMAIL]->(u), (u)-[:MODERATION_PROFILE]->(p), (co)-[:CREATED_BY]->(u)`);
});
function exec(source: string, options: { secure?: boolean; authenticated?: boolean; email?: boolean } = {}) {
  return graphql({ schema: options.secure ? secured : schema, source,
    contextValue: { driver, req: { headers: {} }, user: options.authenticated === false ? undefined : { username: "actor", email: options.email ? "actor@example.test" : null, email_verified: true, data: null }, mayAccessSensitiveContent: false } });
}
function data(result: Awaited<ReturnType<typeof exec>>) {
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data));
}
const cancellations = [
  'cancelInviteForumMod(channelUniqueName:"forum",inviteeUsername:"actor")',
  'cancelInviteForumOwner(channelUniqueName:"forum",inviteeUsername:"actor")',
  'cancelInviteServerAdmin(serverName:"forum",inviteeUsername:"actor")',
  'cancelInviteServerMod(serverName:"forum",inviteeUsername:"actor")',
] as const;
for (const operation of cancellations) {
  test(`${operation.split("(")[0]} serializes true, repeats, false on missing target and rejects anonymous callers`, async () => {
    assert.deepEqual(data(await exec(`mutation{result:${operation}}`)), { result: true });
    assert.deepEqual(data(await exec(`mutation{result:${operation}}`)), { result: true });
    assert.deepEqual(data(await exec(`mutation{result:${operation.replace('"forum"', '"missing"')}}`)), { result: false });
    assert.ok((await exec(`mutation{result:${operation}}`, { secure: true, authenticated: false })).errors);
  });
}
const acceptanceCases = [
  ["acceptForumModInvite", "channelUniqueName", "Channel", "HAS_PENDING_MOD_INVITE", "MODERATOR_OF_CHANNEL"],
  ["acceptForumOwnerInvite", "channelUniqueName", "Channel", "HAS_PENDING_INVITE", "ADMIN_OF_CHANNEL"],
  ["acceptServerAdminInvite", "serverName", "ServerConfig", "HAS_PENDING_SERVER_ADMIN_INVITE", "ADMIN_OF_SERVER"],
  ["acceptServerModInvite", "serverName", "ServerConfig", "HAS_PENDING_SERVER_MOD_INVITE", "MODERATOR_OF_SERVER"],
] as const;
for (const [name, arg, label, pending, membership] of acceptanceCases) {
  test(`${name} serializes membership success and rejects repeated acceptance`, async () => {
    await driver.executeQuery(`MATCH(u:User),(n:${label}) CREATE (n)-[:${pending}]->(u)`);
    const source = `mutation{result:${name}(${arg}:"forum")}`;
    assert.deepEqual(data(await exec(source)), { result: true });
    assert.equal(Number((await driver.executeQuery(`MATCH ()-[r:${membership}]->() RETURN count(r) AS n`)).records[0].get("n")), 1);
    const repeated = await exec(source);
    assert.equal(repeated.data?.result, null); assert.match(repeated.errors?.[0].message ?? "", /No pending/);
    assert.ok((await exec(source, { secure: true, authenticated: false })).errors);
  });
}
for (const [name, arg, label, relation] of [
  ["inviteForumMod", "channelUniqueName", "Channel", "HAS_PENDING_MOD_INVITE"],
  ["inviteForumOwner", "channelUniqueName", "Channel", "HAS_PENDING_INVITE"],
  ["inviteServerAdmin", "serverName", "ServerConfig", "HAS_PENDING_SERVER_ADMIN_INVITE"],
  ["inviteServerMod", "serverName", "ServerConfig", "HAS_PENDING_SERVER_MOD_INVITE"],
] as const) {
  test(`${name} serializes success and preserves mail-failure result after persisted invitation`, async () => {
    const source = `mutation{result:${name}(${arg}:"forum",inviteeUsername:"actor")}`;
    assert.deepEqual(data(await exec(source)), { result: true });
    mailResult = false;
    assert.deepEqual(data(await exec(source)), { result: name.startsWith("inviteServer") });
    assert.equal(Number((await driver.executeQuery(`MATCH (:${label})-[r:${relation}]->(:User) RETURN count(r) AS n`)).records[0].get("n")), 2);
    assert.ok((await exec(source, { secure: true, authenticated: false })).errors);
  });
}
test("forum removals and becoming owner serialize true; missing/duplicate paths preserve failures", async () => {
  assert.deepEqual(data(await exec('mutation{result:becomeForumAdmin(channelUniqueName:"forum")}')), { result: true });
  assert.ok((await exec('mutation{result:becomeForumAdmin(channelUniqueName:"forum")}')).errors);
  for (const operation of ['removeForumOwner(channelUniqueName:"forum",username:"actor")', 'removeForumMod(channelUniqueName:"forum",modProfileName:"Actor Mod")']) {
    assert.deepEqual(data(await exec(`mutation{result:${operation}}`)), { result: true });
    assert.deepEqual(data(await exec(`mutation{result:${operation.replace('"forum"','"missing"')}}`)), { result: false });
  }
});
test("role write projection errors still serialize false after the write commits", async () => {
  await driver.executeQuery("MATCH(u:User),(ch:Channel) CREATE(ch)-[:HAS_PENDING_INVITE]->(u) REMOVE ch.createdAt");
  assert.deepEqual(data(await exec('mutation{result:cancelInviteForumOwner(channelUniqueName:"forum",inviteeUsername:"actor")}')), { result: false });
  assert.equal(Number((await driver.executeQuery("MATCH ()-[r:HAS_PENDING_INVITE]->() RETURN count(r) AS n")).records[0].get("n")), 0);
});
test("collection ordering mutations serialize booleans and preserve explicit item order", async () => {
  for (const source of [
    'mutation{result:addToCollection(input:{collectionId:"collection",itemId:"discussion",itemType:DISCUSSION})}',
    'mutation{result:addToCollection(input:{collectionId:"collection",itemId:"discussion",itemType:DISCUSSION})}',
    'mutation{result:reorderCollectionItem(collectionId:"collection",itemId:"discussion",newPosition:0)}',
  ]) assert.deepEqual(data(await exec(source)), { result: true });
  assert.deepEqual((await driver.executeQuery("MATCH(c:Collection) RETURN c.itemOrder AS ids")).records[0].get("ids"), ["discussion"]);
  assert.deepEqual(data(await exec('mutation{result:removeFromCollection(collectionId:"collection",itemId:"discussion",itemType:DISCUSSION)}')), { result: true });
  assert.deepEqual((await driver.executeQuery("MATCH(c:Collection) RETURN c.itemOrder AS ids")).records[0].get("ids"), []);
  assert.ok((await exec('mutation{result:addToCollection(input:{collectionId:"collection",itemId:"discussion",itemType:DISCUSSION})}', { authenticated: false })).errors);
});
test("ranking settings serialize all normalized fields, nullable metadata, updates and invalid null patches", async () => {
  const fields = 'version discussionHot{ageOffsetMonths gravity} commentHot{ageOffsetMonths gravity} updatedAt updatedBy';
  const initial = data(await exec(`{result:getRankingSettings(serverName:"forum"){${fields}}}`)).result;
  assert.equal(initial.version, 1); assert.equal(initial.updatedAt, null); assert.equal(initial.updatedBy, null);
  const changed = data(await exec(`mutation{result:setRankingSettings(serverName:"forum",input:{discussionHot:{gravity:1.5},commentHot:null}){${fields}}}`)).result;
  assert.equal(changed.discussionHot.gravity, 1.5); assert.equal(changed.updatedBy, "actor"); assert.equal(typeof changed.updatedAt, "string");
  assert.deepEqual(data(await exec(`{result:getRankingSettings(serverName:"forum"){${fields}}}`)).result, changed);
  assert.ok((await exec(`mutation{result:setRankingSettings(serverName:"forum",input:{discussionHot:{gravity:null}}){${fields}}}`)).errors);
  assert.ok((await exec('{getRankingSettings(serverName:"missing"){version}}')).errors);
});
test("own-account summary serializes authenticated, absent and anonymous account states", async () => {
  const source = '{result:getOwnEmail{address username profilePicURL modProfileName unreadNotificationCount}}';
  assert.deepEqual(data(await exec(source)), { result: null });
  const summary = data(await exec(source, { email: true })).result;
  assert.equal(summary.address, "actor@example.test"); assert.equal(summary.username, "actor");
  assert.equal(summary.profilePicURL, null); assert.equal(summary.modProfileName, "Actor Mod"); assert.equal(summary.unreadNotificationCount, 0);
  await driver.executeQuery("MATCH(e:Email) DETACH DELETE e");
  assert.deepEqual(data(await exec(source, { email: true })).result, { address: "actor@example.test", username: null, profilePicURL: null, modProfileName: null, unreadNotificationCount: null });
});
test("age policy and setup capabilities serialize normalized booleans, numbers and lists", async () => {
  const result = await exec('{getAgePolicy{accountAgeGateEnabled minimumAccountAge sensitiveContentAgeGateEnabled minimumSensitiveContentAge} getInstanceSetupStatus{auth{configured enabled requiredEnvVarsMissing setupUrl docsPath} events{configured enabled requiredEnvVarsMissing setupUrl docsPath}}}');
  const response = data(result);
  assert.equal(typeof response.getAgePolicy.accountAgeGateEnabled, "boolean");
  assert.equal(typeof response.getAgePolicy.minimumAccountAge, "number");
  assert.equal(response.getInstanceSetupStatus.auth.configured, false);
  assert.ok(response.getInstanceSetupStatus.auth.requiredEnvVarsMissing.length > 0);
  assert.equal(response.getInstanceSetupStatus.events.configured, true);
  assert.equal(response.getInstanceSetupStatus.events.enabled, false);
  assert.deepEqual(response.getInstanceSetupStatus.events.requiredEnvVarsMissing, []);
});

for (const [name, args, key, urlField, sizeField] of [
  ["setProfileImage", 'username:"actor"', "username", "profilePicURL", "avatar32Url"],
  ["setChannelIcon", 'channelUniqueName:"forum"', "uniqueName", "channelIconURL", "icon32Url"],
] as const) {
  test(`${name} serializes exact generated projection after claiming upload; repeat fails`, async () => {
    await driver.executeQuery("CREATE(:UploadedFileAudit {id:'audit',storageBucket:'fixture',storageObjectName:'uploads/avatar',storageUrl:'https://example.test/avatar',uploadedAt:datetime(),uploadedByUsername:'actor'})");
    const source = `mutation{result:${name}(${args},imageUrl:"https://example.test/avatar"){${key} ${urlField} ${sizeField} variantUrls}}`;
    const result = data(await exec(source)).result;
    assert.equal(result[key], name === "setProfileImage" ? "actor" : "forum");
    assert.equal(result[urlField], "https://example.test/avatar");
    assert.equal(result[sizeField], "https://example.test/avatar32");
    assert.deepEqual(result.variantUrls, {avatar32:"https://example.test/avatar32"});
    assert.equal((await driver.executeQuery("MATCH(a:UploadedFileAudit) RETURN a.claimedAt IS NOT NULL AS claimed")).records[0].get("claimed"), true);
    assert.ok((await exec(source)).errors);
    assert.ok((await exec(source, {secure:true,authenticated:false})).errors);
  });
}
test("registration selects schema-validated username and preserves existing account identity", async () => {
  assert.deepEqual(data(await exec('mutation{result:createEmailAndUser(emailAddress:"actor@example.test",username:"ignored"){username}}',{email:true})), {result:{username:"actor"}});
  assert.ok((await exec('mutation{result:createEmailAndUser(emailAddress:"other@example.test",username:"other"){username}}',{email:true})).errors);
});
test("scratchpad visibility and deletion serialize selected scalar responses and nullable fields", async () => {
  await driver.executeQuery("MATCH(u:User) CREATE(e:ScratchpadEntry {id:'entry',text:'Text',sourceType:'comment',sourceId:'comment',isPublic:false,createdAt:datetime('2026-01-01T00:00:00Z')}) CREATE(u)-[:HAS_SCRATCHPAD_ENTRY]->(e)");
  const source = 'mutation{result:updateScratchpadEntryVisibility(scratchpadEntryId:"entry",isPublic:true){id text isPublic sourceType sourceId sourceChannelUniqueName discussionId createdAt}}';
  assert.deepEqual(data(await exec(source)), {result:{id:"entry",text:"Text",isPublic:true,sourceType:"comment",sourceId:"comment",sourceChannelUniqueName:null,discussionId:null,createdAt:"2026-01-01T00:00:00.000Z"}});
  assert.deepEqual(data(await exec('mutation{result:deleteScratchpadEntry(scratchpadEntryId:"entry")}')), {result:true});
  assert.ok((await exec(source)).errors);
  assert.ok((await exec('mutation{result:deleteScratchpadEntry(scratchpadEntryId:"entry")}')).errors);
});
test("public collection projection serializes selected nested lists and empty matches", async () => {
  const source = '{result:publicCollectionsContaining(itemId:"discussion",itemType:DISCUSSION){id name description visibility collectionType itemCount shareCount itemOrder createdAt updatedAt CreatedBy{username displayName profilePicURL} Downloads{id title}}}';
  assert.deepEqual(data(await exec(source)), {result:[]});
  await driver.executeQuery("MATCH(co:Collection),(d:Discussion) CREATE(co)-[:CONTAINS_DISCUSSION]->(d)");
  const rows = data(await exec(source)).result;
  assert.equal(rows.length, 1); assert.equal(rows[0].id, "collection"); assert.equal(rows[0].visibility, "PUBLIC");
  assert.equal(rows[0].collectionType, "DISCUSSIONS"); assert.equal(rows[0].description, null);
  assert.deepEqual(rows[0].itemOrder, []); assert.deepEqual(rows[0].Downloads, []);
  assert.deepEqual(rows[0].CreatedBy, {username:"actor",displayName:null,profilePicURL:null});
});
test("test-data seed rejects empty content and serializes populated success; drop succeeds", async () => {
  const source = 'mutation{result:seedDataForCypressTests(channels:[],users:[],tags:[],discussions:[],events:[],comments:[],channelRoles:[],modChannelRoles:[],serverRoles:[],modServerRoles:[],serverConfigs:[]){success message}}';
  assert.match((await exec(source)).errors?.[0].message ?? "", /Input cannot be empty/);
  const populated = source.replace('discussions:[]', 'discussions:[{discussionCreateInput:{title:"Seed discussion"},channelConnections:["forum"]}]').replace('events:[]', 'events:[{eventCreateInput:{title:"Seed event",startTime:"2026-01-01T00:00:00Z",endTime:"2026-01-02T00:00:00Z",canceled:false},channelConnections:["forum"]}]');
  assert.deepEqual(data(await exec(populated)), {result:{success:true,message:"All test data has been created."}});
  assert.equal((await driver.executeQuery("MATCH(:User {username:'actor'})-[:POSTED_DISCUSSION]->(d:Discussion {title:'Seed discussion'})<-[:POSTED_IN_CHANNEL]-(:DiscussionChannel {channelUniqueName:'forum'}) RETURN count(d) AS count")).records[0].get("count").toNumber(), 1);
  assert.deepEqual(data(await exec('mutation{result:dropDataForCypressTests{success message}}')), {result:{success:true,message:"All test data has been dropped."}});
});
test("bug-report dependency failure completes as nullable error without sending mail", async () => {
  const previous = process.env.SUPPORT_EMAIL;
  delete process.env.SUPPORT_EMAIL;
  try {
    const result = await exec('mutation{result:sendBugReport(contactEmail:"actor@example.test",subject:"Test",text:"Body",username:null)}');
    assert.equal(result.data?.result, null);
    assert.match(result.errors?.[0].message ?? "", /SUPPORT_EMAIL is not set/);
  } finally { if (previous === undefined) delete process.env.SUPPORT_EMAIL; else process.env.SUPPORT_EMAIL = previous; }
});

test("scratchpad visibility preserves selected author/recipient projections, null links and ownership failures",async()=>{
 await driver.executeQuery("MATCH(u:User {username:'actor'}) CREATE(e:ScratchpadEntry {id:'entry',text:'Text',sourceType:'comment',sourceId:'comment',isPublic:false,createdAt:datetime()}) CREATE(u)-[:HAS_SCRATCHPAD_ENTRY]->(e)");
 const source='mutation{result:updateScratchpadEntryVisibility(scratchpadEntryId:"entry",isPublic:true){id author:Author{...Identity} recipient:Recipient{username}}} fragment Identity on User{username displayName profilePicURL}';
 assert.deepEqual(data(await exec(source)),{result:{id:'entry',author:null,recipient:{username:'actor'}}});
 await driver.executeQuery("MATCH(e:ScratchpadEntry {id:'entry'}) CREATE(a:User{username:'author',displayName:'Author',createdAt:datetime()})-[:WROTE_SCRATCHPAD_ENTRY]->(e)");
 assert.deepEqual(data(await exec(source)),{result:{id:'entry',author:{username:'author',displayName:'Author',profilePicURL:null},recipient:{username:'actor'}}});
 await driver.executeQuery("MATCH(:User)-[r:HAS_SCRATCHPAD_ENTRY]->(e:ScratchpadEntry {id:'entry'}) DELETE r SET e.isPublic=false");
 const rejected=await exec(source);assert.ok(rejected.errors?.some(error=>/Only the recipient/.test(error.message)));
 assert.equal((await driver.executeQuery("MATCH(e:ScratchpadEntry {id:'entry'}) RETURN e.isPublic AS visible")).records[0].get('visible'),false);
});

test("own email aliases preserve verified self scope and onboarding nulls", async () => {
  const query = '{result:getOwnEmail{username:address address:username ...Fields}} fragment Fields on OwnEmail {name:modProfileName picture:profilePicURL count:unreadNotificationCount}';
  assert.deepEqual(data(await exec(query,{secure:true,email:true})).result, {username:'actor@example.test',address:'actor',name:'Actor Mod',picture:null,count:0});
  assert.equal(data(await exec(query,{secure:true,authenticated:false})).result,null);
  await driver.executeQuery('MATCH(e:Email) DETACH DELETE e');
  assert.deepEqual(data(await exec(query,{secure:true,email:true})).result, {username:'actor@example.test',address:null,name:null,picture:null,count:null});
});
test("ranking root and nested aliases retain distinct normalized values and nullable metadata", async () => {
  const fields='v:version commentHot:discussionHot{gravity:ageOffsetMonths ageOffsetMonths:gravity} discussionHot:commentHot{g:gravity} by:updatedBy at:updatedAt';
  const initial=data(await exec(`{result:getRankingSettings(serverName:"forum"){${fields}}}`)).result;
  assert.deepEqual(initial,{v:1,commentHot:{gravity:2,ageOffsetMonths:1.8},discussionHot:{g:1.8},by:null,at:null});
  const changed=data(await exec(`mutation{result:setRankingSettings(serverName:"forum",input:{discussionHot:{gravity:1.5}}){${fields}}}`)).result;
  assert.equal(changed.commentHot.ageOffsetMonths,1.5); assert.equal(changed.by,'actor');
  assert.deepEqual(data(await exec(`{result:getRankingSettings(serverName:"forum"){${fields}}}`)).result,changed);
  assert.ok((await exec('mutation{setRankingSettings(serverName:"forum",input:{discussionHot:{gravity:1.5}}){v:version}}',{secure:true,authenticated:false})).errors);
});
test("instance setup aliases preserve capability differences, nested fragments and skips", async () => {
  const result=data(await exec(`{result:getInstanceSetupStatus{auth:events{...Capability} events:auth{...Capability} mail @skip(if:true){configured}}} fragment Capability on InstanceCapabilityStatus{enabled:configured configured:enabled url:setupUrl missing:requiredEnvVarsMissing}`,{secure:false}));
  assert.equal(result.result.auth.enabled,true); assert.equal(result.result.auth.configured,false);
  assert.equal(result.result.events.enabled,false); assert.equal(result.result.events.url,"/admin/setup#authentication");
  assert.equal(result.result.mail,undefined);
});
