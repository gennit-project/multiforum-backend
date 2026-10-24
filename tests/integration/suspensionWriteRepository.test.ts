import type {GraphQLSchema,GraphQLObjectType} from "graphql";
import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import { createSuspensionWriteRepository } from '../../services/persistence/suspensionWriteRepository.js';
import suspendUser from '../../customResolvers/mutations/suspendUser.js';
import suspendMod from '../../customResolvers/mutations/suspendMod.js';
import unsuspendUser from '../../customResolvers/mutations/unsuspendUser.js';
import unsuspendMod from '../../customResolvers/mutations/unsuspendMod.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {installAgeGateReconcile} from '../../services/ageGate/reconcile.js';
import {getAgeGateStatements} from '../../services/ageGate/definitions.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let schema:GraphQLSchema;let driver:Driver;const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{process.env.SERVER_CONFIG_NAME='server';driver=installAgeGateReconcile(await startNeo4j(),getAgeGateStatements(typeDefs));const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);},{timeout:240_000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
async function seed(scope='channel',entity='user') {await driver.executeQuery(`CREATE (ch:Channel {uniqueName:'forum',createdAt:datetime()}) CREATE (:ServerConfig {serverName:'server'}) CREATE (:ModerationProfile {displayName:'Actor'}) CREATE (u:User {username:'target',createdAt:datetime()})-[:MODERATION_PROFILE]->(:ModerationProfile {displayName:'TargetMod'}) CREATE (i:Issue {id:'i',issueNumber:1,channelUniqueName:$channel,relatedUsername:$username,relatedModProfileName:$mod,authorName:'Actor',title:'Report',createdAt:datetime(),isOpen:true}) FOREACH (_ IN CASE WHEN $scope='channel' THEN [1] ELSE [] END | CREATE (ch)-[:HAS_ISSUE]->(i))`,{scope,channel:scope==='channel'?'forum':'',username:entity==='user'?'target':null,mod:entity==='mod'?'TargetMod':null});events=[];}
const normalize=(value:unknown,unorderedActivityFeed=false)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){
// ActivityFeed has no requested/default sort; native event arrays remain strictly ordered.
if(unorderedActivityFeed && key==='ActivityFeed' && Array.isArray(value))return [...value].sort((a,b)=>String(a.actionType).localeCompare(String(b.actionType)));
if(['id','id_from','id_to'].includes(key)){const namespace=this.event ? (key==='id' && this.event.includes('relationship')?'relationship':'node') : 'domain';const identity=namespace+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','ageGateTouchedAt'].includes(key)&&value!==null?'<time>':value;}));};
async function state(){return (await driver.executeQuery(`MATCH(i:Issue {id:'i'}) RETURN i.isOpen AS open, COUNT { (i)-[:ACTIVITY_ON_ISSUE]->() } AS activities, COUNT { (:Channel)-[:SUSPENDED_AS_USER|SUSPENDED_AS_MOD]->() } AS channelCount, COUNT { (:ServerConfig)-[:SUSPENDED_AS_USER|SUSPENDED_AS_MOD]->() } AS serverCount, COUNT { (:Suspension) } AS suspensions`)).records.map(r=>r.toObject());}
const outcome=async(fn:()=>Promise<unknown>)=>{
 let result:unknown;
 try{result=await fn();}catch(e){return {error:(e as Error).message};}
 if(result && typeof result==='object' && 'ActivityFeed' in result && Array.isArray(result.ActivityFeed)){
  const persisted=(await driver.executeQuery("MATCH(:Issue{id:'i'})-[:ACTIVITY_ON_ISSUE]->(action:ModerationAction) RETURN action.id AS id,action.actionType AS actionType ORDER BY id")).records.map(record=>record.toObject());
  // Check raw generated IDs and every returned action before any aliasing/sibling canonicalization.
  assert.deepEqual(result.ActivityFeed.map(action=>({id:action.id,actionType:action.actionType})).sort((a,b)=>a.id.localeCompare(b.id)),persisted);
 }
 return {result:normalize(result,true)};
};
async function run(repository:any,entity='user',notifyFails=false){const notifications:string[]=[];const context:any={driver,suspensionWriteRepository:repository,user:{username:'actor',data:{ModerationProfile:{displayName:'Actor'}}},notificationSnapshotRepository:{findIssueSubscribers:async()=>{notifications.push('notify');if(notifyFails)throw Error('fake notification failure');return [];}}};const args={issueId:'i',explanation:' reason ',suspendIndefinitely:true};const first=entity==='user'?suspendUser({}):suspendMod();const second=entity==='user'?unsuspendUser():unsuspendMod();const results=[await outcome(()=>first(null,args as never,context,{} as never))];const suspended=await state();if(!('error' in results[0]))results.push(await outcome(()=>second(null,args as never,context,{} as never)));return {results,suspended,final:await state(),notifications,events:normalize(events)};}
for(const scope of ['channel','server'])for(const entity of ['user','mod'])test(`${scope} ${entity} suspension cycle preserves responses, graph, native event ordering and notification boundary`,async(t)=>{await seed(scope,entity);const result=await run(createSuspensionWriteRepository(driver),entity);assert.ok(!('error' in result.results[0]),JSON.stringify(result.results));assert.deepEqual(result.notifications,['notify','notify']);assert.equal(result.suspended[0].activities.toNumber(),2);assert.equal(result.suspended[0][scope==='channel'?'channelCount':'serverCount'].toNumber(),1);assert.equal(result.final[0].channelCount.toNumber(),0);assert.equal(result.final[0].serverCount.toNumber(),0);assert.equal(result.final[0].activities.toNumber(),4);assert.equal(result.final[0].suspensions.toNumber(),1);t.assert.snapshot(result);});
test('notification failure follows committed issue activities and prevents scope suspension',async(t)=>{await seed();const result=await run(createSuspensionWriteRepository(driver),'user',true);assert.match((result.results[0] as any).error,/fake notification failure/);assert.equal(result.final[0].activities.toNumber(),2);assert.equal(result.final[0].suspensions.toNumber(),0);t.assert.snapshot(result);});
// Owned writes no longer round-trip the Issue through the generated projection
// (which required issueNumber: Int!), so a missing issueNumber can no longer
// fail the suspend. The write simply commits — the former partial-write error
// contract is gone with the generated mutation.
test('owned suspension write commits despite a missing issueNumber (no generated Issue projection)',async(t)=>{await seed();await driver.executeQuery("MATCH(i:Issue {id:'i'}) REMOVE i.issueNumber");const result=await run(createSuspensionWriteRepository(driver));assert.ok(!('error' in result.results[0]),JSON.stringify(result.results));assert.equal(result.suspended[0].activities.toNumber(),2);assert.equal(result.suspended[0].suspensions.toNumber(),1);assert.equal(result.final[0].activities.toNumber(),4);assert.equal(result.final[0].suspensions.toNumber(),1);t.assert.snapshot(result);});
// The generated identity guard and scalar coercion no longer apply: the owned
// write takes a flat params object and never mutates immutable Issue identity.
// The surviving invariant is that appending/closing against a non-existent issue
// matches nothing and commits no actions (both action and scalar steps MATCH the
// Issue by id), leaving the seeded issue untouched.
test('owned append/close against a missing issue commits nothing',async()=>{await seed();const repository=createSuspensionWriteRepository(driver);const params={issueId:'does-not-exist',actions:[{actionType:'suspend',actionDescription:'x',text:null,modDisplayName:'Actor',commentChannelUniqueName:'forum'}],isOpen:false};await repository.appendSuspensionActivity(params);const closed=await repository.closeSuspensionIssue(params);assert.deepEqual(closed.issues,[]);assert.equal((await state())[0].activities.toNumber(),0);assert.equal(events.length,0);});

// The unsuspend disconnect is now owned driver Cypher (DELETE the owner->Suspension
// edge), so a broken Channel/ServerConfig default projection resolver — which the
// former generated updateChannels/updateServerConfigs would have hit — no longer
// reaches it. The unsuspend succeeds and the durable disconnect still happens.
for(const scope of ['channel','server'])test(`${scope} unsuspend owned disconnect is insulated from a broken default projection resolver`,async(t)=>{
 const field=(schema.getType(scope==='channel'?'Channel':'ServerConfig') as GraphQLObjectType).getFields()[scope==='channel'?'description':'serverDescription'];const original=field.resolve;field.resolve=()=>{throw Error('fixture default projection failure');};
 try {await seed(scope);const result=await run(createSuspensionWriteRepository(driver));assert.ok(!('error' in result.results[1]),JSON.stringify(result.results));assert.equal(result.final[0].channelCount.toNumber(),0);assert.equal(result.final[0].serverCount.toNumber(),0);assert.equal(result.final[0].activities.toNumber(),4);t.assert.snapshot(result);}finally{field.resolve=original;}
});
