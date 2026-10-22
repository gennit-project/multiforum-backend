import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createImageReportRepository,type ImageReportRepository} from '../../services/persistence/imageReportRepository.js';
import {protectIssueModelIdentity} from '../../services/issueTargetIdentity.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import reportImage from '../../customResolvers/mutations/reportImage.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let old:ImageReportRepository;let current:ImageReportRepository;let projection='';
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push({kind,event}));
before(async()=>{
 driver=await startNeo4j();const app=getCustomResolvers(driver);
 const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,Issue:{flaggedServerRuleViolation:(source:any)=>{if(projection==='create')throw new Error('report create projection');return source.flaggedServerRuleViolation;},relatedImageId:(source:any)=>{if(projection==='append')throw new Error('report append projection');return source.relatedImageId;}}},features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neo.getSchema();initializeOgmFromExistingSchema(app.ogm,neo,schema);registerGeneratedSchema(driver,schema);
 const Image=app.ogm.model('Image');const Issue=protectIssueModelIdentity(app.ogm.model('Issue'));
 old={findReportedImage:id=>Image.find({where:{id},selectionSet:'{id url Uploader {username}}'}),findPriorImageReport:where=>Issue.find({where,selectionSet:'{id issueNumber flaggedServerRuleViolation relatedUsername}'}),createImageReportIssue:input=>Issue.create({input:[input],selectionSet:'{issues {id issueNumber flaggedServerRuleViolation}}'}),appendImageReport:(where,update)=>Issue.update({where,update,selectionSet:'{issues {id issueNumber flaggedServerRuleViolation relatedImageId}}'})};
 current=createImageReportRepository(driver);
},{timeout:240000});
after(async()=>stopNeo4j());beforeEach(async()=>{projection='';await resetDatabase(driver);events=[];});
const seed=async()=>driver.executeQuery("CREATE (u:User {username:'owner',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (i:Image {id:'img',url:'https://example.test/image.png',archived:false,permanentlyRemoved:false}) CREATE (u)-[:UPLOADED_IMAGE]->(i) CREATE (:ModerationProfile {displayName:'Moderator',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:Channel {uniqueName:'forum',createdAt:datetime('2020-01-01T00:00:00Z')})");
const context=()=>({user:{username:'mod',email:null,email_verified:true,data:{ModerationProfile:{displayName:'Moderator'}}}} as never);
const args={imageId:'img',reportText:'reason',selectedForumRules:[],selectedServerRules:['rule'],channelUniqueName:null as string|null};
function normal(value:any,key=''):any {if(key==='timestamp'||key==='createdAt'||key==='updatedAt'||key==='ageGateTouchedAt')return '<time>';if(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value))return '<id>';if(Array.isArray(value))return value.map(v=>normal(v));if(value&&typeof value==='object'){if(typeof value.toNumber==='function')return value.toNumber();return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normal(v,k)]));}return value;}
async function state(){const rows=await driver.executeQuery(`MATCH (i:Issue) OPTIONAL MATCH (i)-[:TARGETS_IMAGE]->(img:Image) OPTIONAL MATCH (i)-[:TARGETS_USER]->(u:User) OPTIONAL MATCH (i)-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction) OPTIONAL MATCH (a)-[:MODERATED_COMMENT]->(c:Comment) OPTIONAL MATCH (m:ModerationProfile)-[:AUTHORED_COMMENT]->(c) RETURN i.issueNumber AS number,i.channelUniqueName AS scope,i.title AS title,i.isOpen AS open,i.flaggedServerRuleViolation AS flag,img.id AS image,u.username AS owner,count(DISTINCT a) AS actions,count(DISTINCT c) AS comments,collect(DISTINCT c.text) AS texts,collect(DISTINCT m.displayName) AS authors ORDER BY scope`);const counters=await driver.executeQuery('MATCH (c) WHERE c:ServerIssueCounter OR c:ChannelIssueCounter RETURN labels(c) AS labels,c.current AS current ORDER BY labels');return {rows:normal(rows.records.map(r=>r.toObject())),counters:normal(counters.records.map(r=>r.toObject())),events:normal(events.map((entry:any)=>({kind:entry.kind,event:{...entry.event,...Object.fromEntries(['id','id_from','id_to'].filter(k=>k in entry.event).map(k=>[k,'<internal-id>']))}})))};}
async function parity(run:(repo:ImageReportRepository)=>Promise<unknown>){await seed();const expected=await run(old);const snapshot=await state();await resetDatabase(driver);await seed();events=[];const actual=await run(current);assert.deepEqual(normal(actual),normal(expected));assert.deepEqual(await state(),snapshot);return snapshot;}
for(const scope of [null,'forum'])test(`image report creation/repeat/closed reopening matches scope ${scope}`,async()=>{
 const snap=await parity(async repo=>{const resolver=reportImage({driver,imageReportRepository:repo});const input={...args,channelUniqueName:scope};await resolver(null,input,context(),{} as never);await driver.executeQuery('MATCH(i:Issue) SET i.isOpen=false');return resolver(null,input,context(),{} as never);});assert.equal(snap.rows.length,1);assert.equal(snap.rows[0].actions,2);assert.equal(snap.rows[0].comments,2);assert.deepEqual(snap.rows[0].authors,['Moderator']);assert.match(snap.rows[0].texts[0],/reason/);assert.equal(snap.rows[0].image,'img');assert.equal(snap.rows[0].owner,'owner');assert.equal(snap.rows[0].open,true);assert.equal(snap.counters[0].current,1);assert.ok(snap.events.length>0);
});
test('server and forum scopes create distinct issues and distinct counters',async()=>{const snap=await parity(async repo=>{const resolver=reportImage({driver,imageReportRepository:repo});await resolver(null,args,context(),{} as never);return resolver(null,{...args,channelUniqueName:'forum'},context(),{} as never);});assert.equal(snap.rows.length,2);assert.equal(snap.counters.length,2);});
test('explicit target and issue filters preserve coercion errors and missing results',async()=>{await seed();assert.deepEqual(await current.findReportedImage('missing'),await old.findReportedImage('missing'));assert.deepEqual(await current.findReportedImage('img'),await old.findReportedImage('img'));for(const where of [{relatedImageId:'missing'},{issueNumber:'wrong'}]){const result=async(repo:ImageReportRepository)=>repo.findPriorImageReport(where as never).catch((e:Error)=>e.message);assert.deepEqual(await result(current),await result(old));}});
for(const mode of ['create','append'])test(`${mode} projection failure preserves counters, committed partial writes and events`,async()=>{projection=mode;const snap=await parity(async repo=>reportImage({driver,imageReportRepository:repo})(null,args,context(),{} as never).then(()=>assert.fail('expected projection error'),(e:Error)=>e.message));assert.equal(snap.rows.length,1);assert.equal(snap.counters[0].current,1);assert.equal(snap.rows[0].actions,mode==='create'?0:1);assert.equal(snap.rows[0].comments,mode==='create'?0:1);assert.ok(snap.events.length>0);});

test('append rejects immutable identity changes before persistence, like protected OGM',async()=>{
 await seed();for(const update of [{issueNumber:99},{channelUniqueName:'other'},{authorName:'other'},{TargetUser:{connect:{where:{node:{username:'other'}}}}}]){
  await assert.rejects(async()=>current.appendImageReport({id:'missing'},update as never),/Issue identity cannot be updated/);
 }const snap=await state();assert.deepEqual(snap.rows,[]);assert.deepEqual(snap.counters,[]);assert.deepEqual(snap.events,[]);
});
