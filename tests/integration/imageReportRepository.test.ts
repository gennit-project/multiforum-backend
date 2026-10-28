import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createImageReportRepository,type ImageReportRepository} from '../../services/persistence/imageReportRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import reportImage from '../../customResolvers/mutations/reportImage.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let current:ImageReportRepository;let projection='';
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push({kind,event}));
before(async()=>{
 driver=await startNeo4j();const app=getCustomResolvers(driver);
 const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,Issue:{flaggedServerRuleViolation:(source:any)=>{if(projection==='create')throw new Error('report create projection');return source.flaggedServerRuleViolation;},relatedImageId:(source:any)=>{if(projection==='append')throw new Error('report append projection');return source.relatedImageId;}}},features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});
 const schema=await neo.getSchema();registerGeneratedSchema(driver,schema);
 current=createImageReportRepository(driver);
},{timeout:240000});
after(async()=>stopNeo4j());beforeEach(async()=>{projection='';await resetDatabase(driver);events=[];});
const seed=async()=>driver.executeQuery("CREATE (u:User {username:'owner',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (i:Image {id:'img',url:'https://example.test/image.png',archived:false,permanentlyRemoved:false}) CREATE (u)-[:UPLOADED_IMAGE]->(i) CREATE (:ModerationProfile {displayName:'Moderator',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:Channel {uniqueName:'forum',createdAt:datetime('2020-01-01T00:00:00Z')})");
const context=()=>({user:{username:'mod',email:null,email_verified:true,data:{ModerationProfile:{displayName:'Moderator'}}}} as never);
const args={imageId:'img',reportText:'reason',selectedForumRules:[],selectedServerRules:['rule'],channelUniqueName:null as string|null};
function normal(value:any,key=''):any {if(key==='timestamp'||key==='createdAt'||key==='updatedAt'||key==='ageGateTouchedAt')return '<time>';if(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value))return '<id>';if(Array.isArray(value))return value.map(v=>normal(v));if(value&&typeof value==='object'){if(typeof value.toNumber==='function')return value.toNumber();return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normal(v,k)]));}return value;}
async function state(){const rows=await driver.executeQuery(`MATCH (i:Issue) OPTIONAL MATCH (i)-[:TARGETS_IMAGE]->(img:Image) OPTIONAL MATCH (i)-[:TARGETS_USER]->(u:User) OPTIONAL MATCH (i)-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction) OPTIONAL MATCH (a)-[:MODERATED_COMMENT]->(c:Comment) OPTIONAL MATCH (m:ModerationProfile)-[:AUTHORED_COMMENT]->(c) RETURN i.issueNumber AS number,i.channelUniqueName AS scope,i.title AS title,i.isOpen AS open,i.flaggedServerRuleViolation AS flag,img.id AS image,u.username AS owner,count(DISTINCT a) AS actions,count(DISTINCT c) AS comments,collect(DISTINCT c.text) AS texts,collect(DISTINCT m.displayName) AS authors ORDER BY scope`);const counters=await driver.executeQuery('MATCH (c) WHERE c:ServerIssueCounter OR c:ChannelIssueCounter RETURN labels(c) AS labels,c.current AS current ORDER BY labels');return {rows:normal(rows.records.map(r=>r.toObject())),counters:normal(counters.records.map(r=>r.toObject())),events:normal(events.map((entry:any)=>({kind:entry.kind,event:{...entry.event,...Object.fromEntries(['id','id_from','id_to'].filter(k=>k in entry.event).map(k=>[k,'<internal-id>']))}})))};}
async function parity(run:(repo:ImageReportRepository)=>Promise<unknown>){await seed();events=[];await run(current);return state();}
for(const scope of [null,'forum'])test(`image report creation/repeat/closed reopening matches scope ${scope}`,async(t)=>{
 const snap=await parity(async repo=>{const resolver=reportImage({driver,imageReportRepository:repo});const input={...args,channelUniqueName:scope};await resolver(null,input,context(),{} as never);await driver.executeQuery('MATCH(i:Issue) SET i.isOpen=false');return resolver(null,input,context(),{} as never);});t.assert.snapshot(snap);assert.equal(snap.rows.length,1);assert.equal(snap.rows[0].actions,2);assert.equal(snap.rows[0].comments,2);assert.deepEqual(snap.rows[0].authors,['Moderator']);assert.match(snap.rows[0].texts[0],/reason/);assert.equal(snap.rows[0].image,'img');assert.equal(snap.rows[0].owner,'owner');assert.equal(snap.rows[0].open,true);assert.equal(snap.counters[0].current,1);assert.equal(snap.events.length,0);
});
test('server and forum scopes create distinct issues and distinct counters',async(t)=>{const snap=await parity(async repo=>{const resolver=reportImage({driver,imageReportRepository:repo});await resolver(null,args,context(),{} as never);return resolver(null,{...args,channelUniqueName:'forum'},context(),{} as never);});t.assert.snapshot(snap);assert.equal(snap.rows.length,2);assert.equal(snap.counters.length,2);});
test('explicit target and issue filters preserve coercion errors and missing results',async(t)=>{await seed();t.assert.snapshot(await current.findReportedImage('missing'));t.assert.snapshot(await current.findReportedImage('img'));for(const where of [{relatedImageId:'missing'},{issueNumber:'wrong'}]){const result=async(repo:ImageReportRepository)=>repo.findPriorImageReport(where as never).catch((e:Error)=>e.message);t.assert.snapshot(await result(current));}});
// v7 owned-write migration (#284): owned Cypher no longer round-trips through the
// generated Issue projection, so a broken resolver (projection=mode) can't fail the
// write; it commits fully. Owned writes also emit no in-process events (see #386).
for(const mode of ['create','append'])test(`${mode}: owned image report write is insulated from a broken Issue projection resolver`,async(t)=>{projection=mode;const snap=await parity(async repo=>reportImage({driver,imageReportRepository:repo})(null,args,context(),{} as never));t.assert.snapshot(snap);assert.equal(snap.rows.length,1);assert.equal(snap.counters[0].current,1);assert.equal(snap.rows[0].actions,1);assert.equal(snap.rows[0].comments,1);assert.equal(snap.events.length,0);});

// v7 owned-write migration (#284): appendImageReport is owned Cypher with typed
// params; the durable invariant is that a write against a missing issue commits
// nothing (MATCH (i:Issue) yields no rows).
test('appending to a missing image issue commits no writes',async()=>{
 await seed();const result=await current.appendImageReport({issueId:'missing',actions:[{actionType:'report',actionDescription:'Reported the image',text:'x',modDisplayName:'Moderator'}],isOpen:true,flaggedServerRuleViolation:false});
 assert.deepEqual(result.issues,[]);const snap=await state();assert.deepEqual(snap.rows,[]);assert.deepEqual(snap.counters,[]);assert.deepEqual(snap.events,[]);
});
