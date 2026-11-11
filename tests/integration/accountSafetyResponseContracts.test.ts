import sourceIdentity from "../../middleware/userChildIdentityMiddleware.js";
import { denyImageExternalIo } from "../denyImageExternalIo.js";
import createSignedStorageURL from "../../customResolvers/mutations/createSignedStorageURL.js";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createInstancePolicyRepository } from "../../services/persistence/instancePolicyRepository.js";
import setMyBirthday from "../../customResolvers/mutations/setMyBirthday.js";
import getMyAgeProfile from "../../customResolvers/queries/getMyAgeProfile.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
let ioGuard: ReturnType<typeof denyImageExternalIo>;
let signMode: "success" | "empty" | "failure" = "success";
let signCalls: Array<{bucket: string; object: string; action: string}> = [];
const previousPublicBucket = process.env.GCS_BUCKET_NAME;
const previousPrivateBucket = process.env.GCS_PRIVATE_DOWNLOAD_BUCKET_NAME;
const previousConfig = process.env.SERVER_CONFIG_NAME;
const adult = `${new Date().getUTCFullYear() - 30}-01-01`;
const minor = `${new Date().getUTCFullYear() - 10}-01-01`;
before(async () => {
  process.env.SERVER_CONFIG_NAME = "account-safety";
  process.env.GCS_BUCKET_NAME = "fixture-public";
  process.env.GCS_PRIVATE_DOWNLOAD_BUCKET_NAME = "fixture-private";
  driver = await startNeo4j();
  const app = getResolvers(driver);
  app.resolvers.Mutation.createSignedStorageURL = createSignedStorageURL({signUrl: async (_storage,bucket,object,options) => {
    signCalls.push({bucket,object,action:options.action});
    if (signMode === "failure") throw new Error("injected signer failure");
    return [signMode === "empty" ? "" : "https://example.test/signed"];
  }});
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
  secured = applyMiddleware(schema, permissions, sourceIdentity);
  schema = applyMiddleware(schema, sourceIdentity);
  ioGuard = denyImageExternalIo();
}, { timeout: 240000 });
afterEach(() => ioGuard?.assertUnused());
after(async () => {
  ioGuard?.restore();
  await stopNeo4j();
  if (previousPublicBucket === undefined) delete process.env.GCS_BUCKET_NAME; else process.env.GCS_BUCKET_NAME = previousPublicBucket;
  if (previousPrivateBucket === undefined) delete process.env.GCS_PRIVATE_DOWNLOAD_BUCKET_NAME; else process.env.GCS_PRIVATE_DOWNLOAD_BUCKET_NAME = previousPrivateBucket;
  if (previousConfig === undefined) delete process.env.SERVER_CONFIG_NAME; else process.env.SERVER_CONFIG_NAME = previousConfig;
});
beforeEach(async () => {
  await resetDatabase(driver);
  signMode = "success"; signCalls = [];
  await driver.executeQuery(`CREATE(:ServerConfig {serverName:'account-safety',accountAgeGateEnabled:true,minimumAccountAge:13,sensitiveContentAgeGateEnabled:true,minimumSensitiveContentAge:18})-[:HAS_DEFAULT_SERVER_ROLE]->(:ServerRole {canUploadFile:true}),
    (:User {username:'actor'}), (:User {username:'adult',dateOfBirth:date($adult)}), (:User {username:'minor',dateOfBirth:date($minor)}),
    (:Discussion {id:'sensitive',hasSensitiveContent:true}), (:Discussion {id:'public',hasSensitiveContent:false})`, {adult,minor});
});
function exec(source: string, username: string | null = "actor", protect = true) {
  return graphql({ schema: protect ? secured : schema, source,
    contextValue: { driver, req: {headers:{}}, user: username ? {username,email:null,email_verified:true,data:null} : undefined, mayAccessSensitiveContent:false } });
}
function data(result: Awaited<ReturnType<typeof exec>>) {
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data));
}
const profile = 'birthday meetsAccountMinimumAge mayAccessSensitiveContent';
const check = (id: string) => `{result:getDiscussionAgeGateCheck(discussionId:"${id}"){requiresAgeCheck status minimumAge}}`;
test("age-check responses retain enum states and disclose no discussion fields", async () => {
  const cases = [[null,"SIGN_IN_REQUIRED"],["actor","BIRTHDAY_REQUIRED"],["minor","UNDER_MINIMUM_AGE"],["adult","ALLOWED"]] as const;
  for (const [username,status] of cases) {
    const restricted = status !== "ALLOWED";
    assert.deepEqual(data(await exec(check("sensitive"),username)), {result:{requiresAgeCheck:restricted,status,minimumAge:restricted?18:null}});
  }
  for (const id of ["public","missing"]) assert.deepEqual(data(await exec(check(id),null)), {result:{requiresAgeCheck:false,status:"ALLOWED",minimumAge:null}});
  await driver.executeQuery("MATCH(c:ServerConfig) SET c.sensitiveContentAgeGateEnabled=false");
  assert.deepEqual(data(await exec(check("sensitive"),null)), {result:{requiresAgeCheck:false,status:"ALLOWED",minimumAge:null}});
});
test("age-check raw sensitive mark keeps historical truthiness rather than Boolean coercion", async () => {
  await driver.executeQuery("MATCH(d:Discussion {id:'sensitive'}) SET d.hasSensitiveContent='legacy truthy mark'");
  assert.equal(data(await exec(check("sensitive"),null)).result.status,"SIGN_IN_REQUIRED");
});
test("own age profile serializes nullable absence and is scoped to context identity", async () => {
  const source = `{result:getMyAgeProfile{${profile}}}`;
  assert.deepEqual(data(await exec(source,null)), {result:null});
  assert.deepEqual(data(await exec(source,"actor")), {result:{birthday:null,meetsAccountMinimumAge:null,mayAccessSensitiveContent:false}});
  assert.deepEqual(data(await exec(source,"adult")), {result:{birthday:adult,meetsAccountMinimumAge:true,mayAccessSensitiveContent:true}});
  assert.deepEqual(data(await exec(source,"minor")), {result:{birthday:minor,meetsAccountMinimumAge:false,mayAccessSensitiveContent:false}});
  assert.deepEqual(data(await exec(source,"missing")), {result:{birthday:null,meetsAccountMinimumAge:null,mayAccessSensitiveContent:false}});
});
test("fixed toString birthday projection preserves numeric/string database values and invalid eligibility", async () => {
  await driver.executeQuery("MATCH(u:User {username:'actor'}) SET u.dateOfBirth=42");
  assert.deepEqual(data(await exec(`{result:getMyAgeProfile{${profile}}}`)), {result:{birthday:"42",meetsAccountMinimumAge:null,mayAccessSensitiveContent:false}});
  assert.equal(data(await exec(check("sensitive"))).result.status,"UNDER_MINIMUM_AGE");
  await driver.executeQuery("MATCH(u:User {username:'actor'}) SET u.dateOfBirth='invalid'");
  assert.equal(data(await exec(`{result:getMyAgeProfile{${profile}}}`)).result.birthday,"invalid");
});
test("birthday setter serializes persisted value, allows exact repeats and rejects changes", async () => {
  const source = `mutation{result:setMyBirthday(birthday:"${adult}"){${profile}}}`;
  const expected = {result:{birthday:adult,meetsAccountMinimumAge:true,mayAccessSensitiveContent:true}};
  assert.deepEqual(data(await exec(source)),expected);
  assert.deepEqual(data(await exec(source)),expected);
  const conflict = await exec(`mutation{result:setMyBirthday(birthday:"${minor}"){${profile}}}`);
  assert.equal(conflict.data,null); assert.match(conflict.errors?.[0].message??"",/BIRTHDAY_ALREADY_SET/);
  assert.equal((await driver.executeQuery("MATCH(u:User {username:'actor'}) RETURN toString(u.dateOfBirth) AS birthday")).records[0].get("birthday"),adult);
});
test("birthday setter authentication, missing account and invalid input remain non-null GraphQL failures", async () => {
  const source = `mutation{result:setMyBirthday(birthday:"${adult}"){${profile}}}`;
  for (const [username,message] of [[null,/Authentication required/],["missing",/Account not found/]] as const) {
    const result=await exec(source,username); assert.equal(result.data,null); assert.match(result.errors?.[0].message??"",message);
  }
  const invalid=await exec(`mutation{result:setMyBirthday(birthday:"not-a-date"){${profile}}}`);
  assert.equal(invalid.data,null);assert.match(invalid.errors?.[0].message??"",/INVALID_BIRTHDAY/);
  assert.equal((await driver.executeQuery("MATCH(u:User {username:'actor'}) RETURN u.dateOfBirth AS birthday")).records[0].get("birthday"),null);
});
test("policy read failure remains after committed birthday write and before response completion", async () => {
  const field=schema.getMutationType()!.getFields().setMyBirthday, original=field.resolve;
  field.resolve=setMyBirthday({driver,agePolicyRepository:{findAgePolicyConfigs:async()=>{throw Error("injected policy read");}}});
  try {
    const result=await exec(`mutation{result:setMyBirthday(birthday:"${adult}"){${profile}}}`,"actor",false);
    assert.equal(result.data,null);assert.match(result.errors?.[0].message??"",/injected policy read/);
    assert.equal((await driver.executeQuery("MATCH(u:User {username:'actor'}) RETURN toString(u.dateOfBirth) AS birthday")).records[0].get("birthday"),adult);
  } finally {field.resolve=original;}
});
test("birthday read driver failure remains an error on the nullable profile root", async () => {
  const failed = new Proxy(driver,{get(target,key){
    if(key==="session")return (...args:Parameters<Driver["session"]>)=>{const session=target.session(...args);return new Proxy(session,{get(s,k){if(k==="run")return async()=>{throw Error("injected birthday read");};const value=Reflect.get(s,k);return typeof value==="function"?value.bind(s):value;}});};
    const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
  }});
  const field=schema.getQueryType()!.getFields().getMyAgeProfile, original=field.resolve;
  field.resolve=getMyAgeProfile({driver:failed,agePolicyRepository:createInstancePolicyRepository(driver)});
  try {const result=await exec(`{result:getMyAgeProfile{${profile}}}`,"actor",false);assert.equal(result.data?.result,null);assert.match(result.errors?.[0].message??"",/injected birthday read/);} finally {field.resolve=original;}
});
test("safety-check optional environment values complete as nullable scalars", async () => {
  const previous=process.env.NEO4J_URI;
  try {
    delete process.env.NEO4J_URI;
    assert.deepEqual(data(await exec('{result:safetyCheck{environment{isTestEnvironment currentDatabase}}}',null,false)),{result:{environment:{isTestEnvironment:null,currentDatabase:null}}});
    process.env.NEO4J_URI="bolt://localhost:1234";
    assert.deepEqual(data(await exec('{result:safetyCheck{environment{isTestEnvironment currentDatabase}}}',null,false)),{result:{environment:{isTestEnvironment:true,currentDatabase:"bolt://localhost:1234"}}});
  } finally {if(previous===undefined)delete process.env.NEO4J_URI;else process.env.NEO4J_URI=previous;}
});

const signedFields = 'url storageBucket storageObjectName storageUrl uploadedAt';
test("upload URL response serializes public/private signing metadata and persisted audit", async () => {
  for (const [target,bucket] of [["PUBLIC_MEDIA","fixture-public"],["PRIVATE_DOWNLOAD","fixture-private"]] as const) {
    const response = data(await exec(`mutation{result:createSignedStorageURL(filename:"image.png",contentType:"image/png",uploadTarget:${target}){${signedFields}}}`)).result;
    assert.equal(response.url,"https://example.test/signed");assert.equal(response.storageBucket,bucket);
    assert.equal(typeof response.storageObjectName,"string");assert.ok(response.storageUrl.includes(bucket));assert.equal(typeof response.uploadedAt,"string");
    const audit=(await driver.executeQuery("MATCH(a:UploadedFileAudit {storageObjectName:$name}) RETURN a.storageBucket AS bucket,a.uploadedByUsername AS username",{name:response.storageObjectName})).records[0];
    assert.equal(audit.get("bucket"),bucket);assert.equal(audit.get("username"),"actor");
  }
  assert.deepEqual(signCalls.map(call=>call.action),["write","write"]);
});
test("empty signing response completes absent metadata as null and does not write audit", async () => {
  signMode="empty";
  assert.deepEqual(data(await exec(`mutation{result:createSignedStorageURL(filename:"image.png",contentType:"image/png",uploadTarget:null){${signedFields}}}`)),{result:{url:"",storageBucket:null,storageObjectName:null,storageUrl:null,uploadedAt:null}});
  assert.equal(signCalls[0].bucket,"fixture-public");
  assert.equal(Number((await driver.executeQuery("MATCH(a:UploadedFileAudit) RETURN count(a) AS n")).records[0].get("n")),0);
});
test("signer failures and existing explicit-null channel errors remain errors before audit", async () => {
  signMode="failure";
  const failure=await exec(`mutation{result:createSignedStorageURL(filename:"image.png",contentType:"image/png"){${signedFields}}}`);
  assert.equal(failure.data?.result,null);assert.match(failure.errors?.[0].message??"",/injected signer failure/);
  signCalls=[];
  for (const [filename,contentType] of [["image.png","image/png"],["file.stl","application/octet-stream"]]) {
    const result=await exec(`mutation{result:createSignedStorageURL(filename:"${filename}",contentType:"${contentType}",channelConnections:null){url}}`);
    assert.equal(result.data?.result,null);assert.match(result.errors?.[0].message??"",/Cannot read properties of null.*length/);
  }
  assert.equal(signCalls.length,0);
  assert.equal(Number((await driver.executeQuery("MATCH(a:UploadedFileAudit) RETURN count(a) AS n")).records[0].get("n")),0);
});
test("upload authentication and channel image policy are checked before signing", async () => {
  const source=`mutation{result:createSignedStorageURL(filename:"image.png",contentType:"image/png"){url}}`;
  assert.ok((await exec(source,null)).errors);
  await driver.executeQuery("CREATE(:Channel {uniqueName:'no-images',imageUploadsEnabled:false})");
  const disabled=await exec('mutation{result:createSignedStorageURL(filename:"image.png",contentType:"image/png",channelConnections:["no-images"]){url}}');
  assert.match(disabled.errors?.[0].message??"",/Image uploads are disabled/);assert.equal(signCalls.length,0);
});

test("own age profile aliases and fragments retain nullable eligibility and caller identity", async () => {
  const query='{result:getMyAgeProfile{date:birthday ...Eligibility}} fragment Eligibility on OwnAgeProfile {mayAccessSensitiveContent:meetsAccountMinimumAge meetsAccountMinimumAge:mayAccessSensitiveContent}';
  assert.deepEqual(data(await exec(query,'actor')).result,{date:null,mayAccessSensitiveContent:null,meetsAccountMinimumAge:false});
  assert.deepEqual(data(await exec(query,'adult')).result,{date:adult,mayAccessSensitiveContent:true,meetsAccountMinimumAge:true});
  assert.equal(data(await exec(query,null)).result,null);
});
test("birthday write aliases return persisted eligibility and retain repeat/conflict behavior", async () => {
  const query=`mutation{result:setMyBirthday(birthday:"${adult}"){date:birthday permitted:mayAccessSensitiveContent minimum:meetsAccountMinimumAge}}`;
  const expected={date:adult,permitted:true,minimum:true};
  assert.deepEqual(data(await exec(query)).result,expected);
  assert.deepEqual(data(await exec(query)).result,expected);
  assert.ok((await exec(`mutation{setMyBirthday(birthday:"${minor}"){date:birthday}}`)).errors);
});

test("age policy and gate aliases retain distinct thresholds and every viewer state", async () => {
  const policy=data(await exec('{result:getAgePolicy{minimumAccountAge:minimumSensitiveContentAge minimumSensitiveContentAge:minimumAccountAge enabled:accountAgeGateEnabled}}',null)).result;
  assert.deepEqual(policy,{minimumAccountAge:18,minimumSensitiveContentAge:13,enabled:true});
  for(const [username,status] of [[null,'SIGN_IN_REQUIRED'],['actor','BIRTHDAY_REQUIRED'],['minor','UNDER_MINIMUM_AGE'],['adult','ALLOWED']] as const) {
    const result=data(await exec('{result:getDiscussionAgeGateCheck(discussionId:"sensitive"){value:status needed:requiresAgeCheck age:minimumAge}}',username)).result;
    assert.deepEqual(result,{value:status,needed:status!=='ALLOWED',age:status==='ALLOWED'?null:18});
  }
  assert.deepEqual(data(await exec('{result:getDiscussionAgeGateCheck(discussionId:"missing"){value:status age:minimumAge}}',null)).result,{value:'ALLOWED',age:null});
});

test("safety environment aliases preserve optional values using only a fixture URI", async () => {
  const previous=process.env.NEO4J_URI;
  const query='{result:safetyCheck{value:environment{isTestEnvironment:currentDatabase currentDatabase:isTestEnvironment}}}';
  try {
    process.env.NEO4J_URI='bolt://localhost:1234';
    assert.deepEqual(data(await exec(query,null,false)),{result:{value:{isTestEnvironment:'bolt://localhost:1234',currentDatabase:true}}});
    delete process.env.NEO4J_URI;
    assert.deepEqual(data(await exec(query,null,false)),{result:{value:{isTestEnvironment:null,currentDatabase:null}}});
  } finally {if(previous===undefined)delete process.env.NEO4J_URI;else process.env.NEO4J_URI=previous;}
});

test('signed upload response preserves colliding URL and bucket aliases',async()=>{
 const result=data(await exec('mutation{result:createSignedStorageURL(filename:"image.png",contentType:"image/png"){url:storageBucket storageBucket:url}}')).result;
 assert.deepEqual(result,{url:'fixture-public',storageBucket:'https://example.test/signed'});
});
