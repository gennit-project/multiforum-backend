import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createProfilePictureReportRepository,type ProfilePictureReportRepository} from '../../services/persistence/profilePictureReportRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import reportProfilePicture from '../../customResolvers/mutations/reportProfilePicture.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let current:ProfilePictureReportRepository;let projection='';
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push({kind,event}));
before(async()=>{
 driver=await startNeo4j();const app=getCustomResolvers(driver);
 const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,Issue:{flaggedServerRuleViolation:(source:any)=>{if(projection==='create')throw new Error('report create projection');return source.flaggedServerRuleViolation;},relatedProfilePicUserId:(source:any)=>{if(projection==='append')throw new Error('report append projection');return source.relatedProfilePicUserId;}}},features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neo.getSchema();registerGeneratedSchema(driver,schema);
 current=createProfilePictureReportRepository(driver);
},{timeout:240000});
after(async()=>stopNeo4j());beforeEach(async()=>{projection='';await resetDatabase(driver);events=[];});
const seed=async()=>driver.executeQuery("CREATE (:User {username:'owner',displayName:'Original Name',profilePicURL:'https://example.test/first.png',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:User {username:'other',profilePicURL:'https://example.test/other.png',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:ModerationProfile {displayName:'Moderator',createdAt:datetime('2020-01-01T00:00:00Z')})");
const context=()=>({user:{username:'mod',email:null,email_verified:true,data:{ModerationProfile:{displayName:'Moderator'}}}} as never);
const args={username:'owner',reportText:'reason',selectedServerRules:['rule']};
function normal(value:any,key=''):any {if(key==='timestamp'||key==='createdAt'||key==='updatedAt'||key==='ageGateTouchedAt')return '<time>';if(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value))return '<id>';if(Array.isArray(value))return value.map(v=>normal(v));if(value&&typeof value==='object'){if(typeof value.toNumber==='function')return value.toNumber();return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normal(v,k)]));}return value;}
async function state(){const rows=await driver.executeQuery(`MATCH (i:Issue) OPTIONAL MATCH (i)-[:TARGETS_PROFILE_PICTURE_USER]->(pic:User) OPTIONAL MATCH (i)-[:TARGETS_USER]->(u:User) OPTIONAL MATCH (i)-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction) OPTIONAL MATCH (a)-[:MODERATED_COMMENT]->(c:Comment) OPTIONAL MATCH (m:ModerationProfile)-[:AUTHORED_COMMENT]->(c) RETURN i.issueNumber AS number,i.channelUniqueName AS scope,i.title AS title,i.isOpen AS open,i.flaggedServerRuleViolation AS flag,pic.username AS profile,u.username AS owner,count(DISTINCT a) AS actions,count(DISTINCT c) AS comments,collect(DISTINCT c.text) AS texts,collect(DISTINCT m.displayName) AS authors ORDER BY number`);const counters=await driver.executeQuery('MATCH (c:ServerIssueCounter) RETURN c.current AS current');return {rows:normal(rows.records.map(r=>r.toObject())),counters:normal(counters.records.map(r=>r.toObject())),events:normal(events.map((entry:any)=>({kind:entry.kind,event:{...entry.event,...Object.fromEntries(['id','id_from','id_to'].filter(k=>k in entry.event).map(k=>[k,'<internal-id>']))}})))};}
async function parity(run:(repo:ProfilePictureReportRepository)=>Promise<unknown>){await seed();events=[];await run(current);return state();}
test('replacing profile URL/display name reuses owner issue, reopens and appends without changing original title',async(t)=>{
 const snap=await parity(async repo=>{const resolver=reportProfilePicture({driver,profilePictureReportRepository:repo});await resolver(null,args,context(),{} as never);await driver.executeQuery("MATCH(i:Issue) SET i.isOpen=false,i.flaggedServerRuleViolation=false WITH i MATCH(u:User {username:'owner'}) SET u.profilePicURL='https://example.test/replaced.png',u.displayName='New Name'");return resolver(null,args,context(),{} as never);});t.assert.snapshot(snap);assert.equal(snap.rows.length,1);assert.equal(snap.rows[0].actions,2);assert.equal(snap.rows[0].comments,2);assert.deepEqual(snap.rows[0].authors,['Moderator']);assert.match(snap.rows[0].texts[0],/reason/);assert.equal(snap.rows[0].profile,'owner');assert.equal(snap.rows[0].owner,'owner');assert.equal(snap.rows[0].title,'[Reported profile picture] Original Name');assert.equal(snap.rows[0].open,true);assert.equal(snap.rows[0].flag,true);assert.equal(snap.counters[0].current,1);assert.equal(snap.events.length,0);
});
test('different owners get distinct server-scoped issues and sequential counter values',async(t)=>{const snap=await parity(async repo=>{const resolver=reportProfilePicture({driver,profilePictureReportRepository:repo});await resolver(null,args,context(),{} as never);return resolver(null,{...args,username:'other'},context(),{} as never);});t.assert.snapshot(snap);assert.equal(snap.rows.length,2);assert.deepEqual(snap.rows.map((r:any)=>r.number),[1,2]);assert.equal(snap.counters[0].current,2);});
test('profile target and prior lookup preserve selected fields, absent users and input coercion',async(t)=>{await seed();for(const name of ['owner','missing',123]){const result=async(repo:ProfilePictureReportRepository)=>repo.findReportedProfile(name as never).catch((e:Error)=>e.message);t.assert.snapshot(await result(current));}t.assert.snapshot(await current.findPriorProfileReport('owner'));});
// v7 owned-write migration (#284): owned Cypher no longer round-trips through the
// generated Issue projection, so a broken resolver (projection=mode) can't fail the
// write; it commits fully. Owned writes also emit no in-process events (see #386).
for(const mode of ['create','append'])test(`${mode}: owned profile report write is insulated from a broken Issue projection resolver`,async(t)=>{projection=mode;const snap=await parity(async repo=>reportProfilePicture({driver,profilePictureReportRepository:repo})(null,args,context(),{} as never));t.assert.snapshot(snap);assert.equal(snap.rows.length,1);assert.equal(snap.counters[0].current,1);assert.equal(snap.rows[0].actions,1);assert.equal(snap.rows[0].comments,1);assert.equal(snap.events.length,0);});

// v7 owned-write migration (#284): a write against a missing issue commits nothing.
test('appending to a missing profile issue commits no writes',async()=>{
 await seed();const result=await current.appendProfileReport({issueId:'missing',actions:[{actionType:'report',actionDescription:'Reported the profile picture',text:'x',modDisplayName:'Moderator'}],isOpen:true,flaggedServerRuleViolation:false});
 assert.deepEqual(result.issues,[]);const snap=await state();assert.deepEqual(snap.rows,[]);assert.deepEqual(snap.counters,[]);assert.deepEqual(snap.events,[]);
});
