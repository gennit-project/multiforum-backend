import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLSchema,GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import * as persistence from '../../services/persistence/downloadReviewRepository.js';
import {createClearDownloadableFileScanResolver} from '../../customResolvers/mutations/clearDownloadableFileScan.js';
import requestReview from '../../customResolvers/mutations/requestDownloadableFileReview.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let app:ReturnType<typeof getCustomResolvers>;let schema:GraphQLSchema;let events:any[]=[];const engine=createSubscriptionEngine();
for(const kind of ['update','create','create_relationship','delete_relationship'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=await startNeo4j();app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const seed=(legacyNotificationEdge=false)=>driver.executeQuery("CREATE(u:User{username:'alice',createdAt:datetime('2020-01-01T00:00:00Z')})-[:POSTED_DISCUSSION]->(d:Discussion{id:'d',title:'Download',hasSensitiveContent:false,createdAt:datetime('2020-01-01T00:00:00Z')})-[:HAS_DOWNLOADABLE_FILE]->(f:DownloadableFile{id:'f',fileName:'fixture.zip',kind:'ZIP',url:'https://example.invalid/fixture.zip',createdAt:datetime('2020-01-01T00:00:00Z'),priceModel:'FREE',scanStatus:'SUSPICIOUS',uploadedByUsername:'alice'}) FOREACH(_ IN CASE WHEN $legacyNotificationEdge THEN [1] ELSE [] END | CREATE(u)-[:AUTHORED_DISCUSSION]->(d))",{legacyNotificationEdge});
const readSelections={findPreparation:persistence.FINDPREPARATION_SELECTION,findReleaseStatus:persistence.FINDRELEASESTATUS_SELECTION,findCleared:persistence.FINDCLEARED_SELECTION,findReviewAuthority:persistence.FINDREVIEWAUTHORITY_SELECTION,findRequested:persistence.FINDREQUESTED_SELECTION};
const state=async()=> (await driver.executeQuery("MATCH(f:DownloadableFile{id:'f'}) RETURN toString(id(f)) AS identity,properties(f) AS properties")).records[0].toObject();
function normalize(v:unknown){return JSON.parse(JSON.stringify(v,function(key,value){if(this.event&&key==='id')return 'file-node';return ['timestamp','ageGateTouchedAt'].includes(key)?'<time>':value;}));}
const plain=(v:unknown)=>JSON.parse(JSON.stringify(v));
async function assertUpdateEvent(){const row=await state();assert.equal(events.length,1);const e=events[0];assert.equal(e.event,'update');assert.equal(e.typename,'DownloadableFile');assert.equal(e.id,row.identity);assert.equal(e.properties.old.scanStatus,'SUSPICIOUS');assert.equal(e.properties.old.id,'f');assert.equal(e.properties.new.id,'f');assert.deepEqual(e.properties.new.ageGateTouchedAt,row.properties.ageGateTouchedAt);assert.equal(e.properties.new.ageGateTouchedAt.toStandardDate().getTime(),e.timestamp);return normalize({events,properties:row.properties});}
test('all five snapshots preserve fields, missing rows, literal IDs and generated read authorization',async(t)=>{
 await seed();const next=persistence.createDownloadReviewRepository(driver);
 assert.equal((await next.findPreparation('f'))[0].Discussion?.Author?.username,'alice');
 assert.equal((await next.findReviewAuthority('f'))[0].Discussion?.Author?.username,'alice');
 for(const name of Object.keys(readSelections) as Array<keyof typeof readSelections>){t.assert.snapshot(plain(await next[name]('f')));t.assert.snapshot(plain(await next[name]('quote"\\id')));assert.deepEqual(await next[name]('missing'),[]);}
 await driver.executeQuery("MATCH(f:DownloadableFile{id:'f'}) SET f.ageGateRestricted=true");
 for(const name of Object.keys(readSelections) as Array<keyof typeof readSelections>){assert.deepEqual(await next[name]('f'),[]);}
});
for(const method of ['clearScan','requestReview'] as const)for(const failProjection of [false,true])test(`${method} preserves committed update and native event when projection failure=${failProjection}`,async(t)=>{
 const field=(schema.getType('DownloadableFile') as GraphQLObjectType).getFields().fileName,original=field.resolve;
 const update=method==='clearScan'?{scanStatus:'CLEAN',scanReason:'Cleared fixture',scanCheckedAt:'2026-01-01T00:00:00Z',reviewRequestedAt:null,reviewRequestReason:null,reviewRequestedByUsername:null}:{reviewRequestedAt:'2026-01-01T00:00:00Z',reviewRequestReason:'Review fixture',reviewRequestedByUsername:'alice'};
 if(failProjection)field.resolve=()=>{throw Error('fixture projection failure');};
 try{await resetDatabase(driver);await seed();events=[];const work=persistence.createDownloadReviewRepository(driver)[method]('f',update as never);if(failProjection)await assert.rejects(work,{message:'fixture projection failure'});else await work;t.assert.snapshot(await assertUpdateEvent());}finally{field.resolve=original;}
});
for(const method of ['clearScan','requestReview'] as const)test(`${method} retains input coercion failure before write`,async()=>{await seed();const repo=persistence.createDownloadReviewRepository(driver);await assert.rejects(repo[method]('f',{scanReason:123} as never),/String cannot represent a non string value/);assert.equal((await state()).properties.scanStatus,'SUSPICIOUS');});
for(const action of ['clear','request'] as const)test(`actual ${action} resolver stops after committed projection failure`,async()=>{
 const field=(schema.getType('DownloadableFile') as GraphQLObjectType).getFields().fileName,original=field.resolve;field.resolve=()=>{throw Error('fixture projection failure');};
 try{{await resetDatabase(driver);await seed(true);events=[];const repository=persistence.createDownloadReviewRepository(driver);const resolver=action==='clear'?createClearDownloadableFileScanResolver({driver,downloadReviewRepository:repository}):requestReview({driver,downloadReviewRepository:repository});await assert.rejects(resolver(null,{downloadableFileId:'f',reason:' Reviewed '},{user:{username:'alice'}} as never),{message:'fixture projection failure'});const row=await state();assert.equal(action==='clear'?row.properties.scanStatus:row.properties.reviewRequestedByUsername,action==='clear'?'CLEAN':'alice');await assertUpdateEvent();assert.equal((await driver.executeQuery('MATCH(n:Notification) RETURN count(n) AS count')).records[0].get('count').toNumber(),0);}}finally{field.resolve=original;}
});
// GraphQL Author uses POSTED_DISCUSSION. The legacy raw notification query
// uses AUTHORED_DISCUSSION instead; characterize both graph shapes unchanged.
for(const {action,legacyNotificationEdge} of [{action:'clear',legacyNotificationEdge:false},{action:'clear',legacyNotificationEdge:true},{action:'request',legacyNotificationEdge:false}] as const)test(`actual ${action} success, legacy notification edge=${legacyNotificationEdge}`,async(t)=>{
 {
  await resetDatabase(driver);await seed(legacyNotificationEdge);events=[];
  const repository=persistence.createDownloadReviewRepository(driver);
  const resolver=action==='clear'?createClearDownloadableFileScanResolver({driver,downloadReviewRepository:repository}):requestReview({driver,downloadReviewRepository:repository});
  const response=await resolver(null,{downloadableFileId:'f',reason:' Reviewed '},{user:{username:'alice'}} as never);
  const row=await state();
  const timeField=action==='clear'?'scanCheckedAt':'reviewRequestedAt';
  assert.equal(Date.parse(String(response[timeField])),row.properties[timeField].toStandardDate().getTime());
  const notifications=(await driver.executeQuery('MATCH(u:User)-[:HAS_NOTIFICATION]->(n:Notification) RETURN u.username AS author,n.text AS text,n.notificationType AS type,n.read AS read')).records.map(r=>r.toObject());
  assert.deepEqual(notifications,action==='clear'&&legacyNotificationEdge?[{author:'alice',text:'Your downloadable file passed human security review and is now available. Cleared by alice: Reviewed',type:'moderation',read:false}]:[]);
  const actual=JSON.parse(JSON.stringify({response,properties:row.properties,notifications},function(key,value){if(this.event&&key==='id')return 'file-node';return ['timestamp','ageGateTouchedAt',timeField].includes(key)?'<time>':value;}));
  t.assert.snapshot(actual);
 }
});
