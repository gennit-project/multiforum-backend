import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createIssueCreationRepository} from '../../services/persistence/issueCreationRepository.js';
import {attachIssueIdentityRelationships,issueTargetDefinitions} from '../../services/issueTargetIdentity.js';
import createIssue from '../../customResolvers/mutations/createIssue.js';
import getNextIssueNumber from '../../customResolvers/mutations/utils/getNextIssueNumber.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {installAgeGateReconcile} from '../../services/ageGate/reconcile.js';
import {getAgeGateStatements} from '../../services/ageGate/definitions.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;
const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=installAgeGateReconcile(await startNeo4j(),getAgeGateStatements(typeDefs));const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});const schema=await neo.getSchema();registerGeneratedSchema(driver,schema);},{timeout:240_000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const input=()=>({channelUniqueName:'forum',issueNumber:1,authorName:'alice',relatedUsername:'alice',isOpen:true,Author:{User:{connect:{where:{node:{username:'alice'}}}}}});
const seed=async()=>{await driver.executeQuery(`CREATE (:Channel {uniqueName:'forum'}),(:User {username:'alice'}),(:ModerationProfile {displayName:'mod'}),(:Discussion {id:'d'}),(:Comment {id:'c'}),(:Event {id:'e'}),(:WikiPage {id:'w'}),(:TextVersion {id:'v'}),(:Image {id:'im'}),(:Album {id:'a'})`);};
const normalized=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const namespace=key==='id' && this.event?.includes('relationship')?'relationship':'node';const identity=namespace+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','ageGateTouchedAt'].includes(key)?'<time>':value;}));};
const snapshot=async()=>({rows:(await driver.executeQuery(`MATCH (i:Issue) OPTIONAL MATCH (i)-[r]-(t) RETURN i.issueNumber AS number,i.locked AS locked,i.ageGateTouchedAt IS NOT NULL AS touched,type(r) AS relation,coalesce(t.id,t.username,t.uniqueName,t.displayName) AS target ORDER BY number,relation,target`)).records.map(r=>r.toObject())});
const newCreate=async(value:any)=>createIssueCreationRepository(driver).create(attachIssueIdentityRelationships(value));
test('all eleven typed targets, channel and both author unions retain graph/default/event parity',async(t)=>{
 const values:Record<string,string>={relatedDiscussionId:'d',relatedCommentId:'c',relatedEventId:'e',relatedWikiPageId:'w',relatedWikiRevisionId:'v',relatedImageId:'im',relatedAlbumId:'a',relatedUsername:'alice',relatedModProfileName:'mod',relatedProfilePicUserId:'alice',relatedChannelUniqueName:'forum'};
 for(const [index,definition] of issueTargetDefinitions.entries()){
  const value:any={...input(),relatedUsername:undefined,[definition.scalarField]:values[definition.scalarField],issueNumber:index+1};
  if(definition.scalarField==='relatedWikiRevisionId')value.relatedWikiPageId='w';
  if(index%2){value.authorName='mod';value.Author={ModerationProfile:{connect:{where:{node:{displayName:'mod'}}}}};}
  await resetDatabase(driver);await seed();events=[];const actual=await newCreate(value);const snap=await snapshot();assert.ok(snap.rows.some(row=>row.relation===definition.relationshipType));assert.ok(snap.rows.every(row=>row.touched));t.assert.snapshot({...actual,id:'generated'});t.assert.snapshot(snap);
 }
});
test('invalid identity and generated input coercion retain errors and no writes',async()=>{
 await seed();const invalidCases:[any,RegExp][]=[
  [{...input(),authorName:'wrong'},/immutable author snapshot/],
  [{...input(),TargetUser:{connect:{where:{node:{username:'other'}}}}},/TargetUser must match its immutable issue identity/],
  [{...input(),relatedModProfileName:'mod'},/cannot target both a user and a moderation profile/],
  [{...input(),isOpen:'invalid'},/Boolean cannot represent a non boolean value/],
 ];
 for(const [value,message] of invalidCases){
  await assert.rejects(newCreate(value),message);assert.deepEqual((await snapshot()).rows,[]);
 }
});
test('real resolver consumes allocated numbers on identity rejection and catches up to existing numbers',async()=>{
 await seed();await driver.executeQuery(`CREATE (:Issue {issueNumber:40,channelUniqueName:'forum'})`);
 const resolver=createIssue({driver});await assert.rejects(resolver(null,{input:{...input(),authorName:'wrong'} as any}),/Error creating issue/);
 assert.equal((await driver.executeQuery(`MATCH (c:ChannelIssueCounter) RETURN c.current AS number`)).records[0].get('number').toNumber(),41);
 const result=await resolver(null,{input:{...input(),issueNumber:900} as any});assert.equal(result.issueNumber,42);
});
test('counter concurrency remains unique without combining allocation and creation',async()=>{
 await seed();await driver.executeQuery("CREATE (:ChannelIssueCounter {channelUniqueName:'forum',current:0})");
 const numbers=await Promise.all(Array.from({length:6},()=>getNextIssueNumber(driver,'forum')));assert.deepEqual(numbers.sort((a,b)=>a-b),[1,2,3,4,5,6]);
});
test('sensitive target creation retains reconciliation before commit',async()=>{
 const value={...input(),relatedUsername:undefined,relatedDiscussionId:'d'};
 const run=async(create:(value:any)=>Promise<unknown>)=>{await resetDatabase(driver);await seed();await driver.executeQuery("MATCH (d:Discussion {id:'d'}) SET d.hasSensitiveContent=true");await create(value);return (await driver.executeQuery('MATCH(i:Issue) RETURN i.ageGateRestricted AS restricted,i.ageGateTouchedAt IS NOT NULL AS touched')).records[0].toObject();};
 assert.deepEqual(await run(newCreate),{restricted:true,touched:true});
});
test('selected projection errors preserve durable writes and native events',async(t)=>{
 // GraphQL input accepts Int 2147483647; generated projection stays valid.
 // Simulate a response resolver failure on the same supported schema for both APIs.
 const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,Issue:{flaggedServerRuleViolation:()=>{throw new Error('projection failure');}}},features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});
 const schema=await neo.getSchema();registerGeneratedSchema(driver,schema);
 await seed();await resetDatabase(driver);await seed();events=[];await assert.rejects(newCreate(input()),/projection failure/);const snap=await snapshot();assert.ok(snap.rows.length);t.assert.snapshot(snap);
});
