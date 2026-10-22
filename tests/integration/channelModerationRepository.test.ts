import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLResolveInfo} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createChannelModerationRepository,type ChannelModerationRepository} from '../../services/persistence/channelModerationRepository.js';
import {protectIssueModelIdentity} from '../../services/issueTargetIdentity.js';
import lockChannel from '../../customResolvers/mutations/lockChannel.js';
import unlockChannel from '../../customResolvers/mutations/unlockChannel.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];
const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push({kind,event}));
async function schema(failChannel=false){const app=getCustomResolvers(driver);ogm=app.ogm;const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:failChannel?{...app.resolvers,Channel:{lockReason:()=>{throw Error('channel projection failed');}}}:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const value=await neo.getSchema();initializeOgmFromExistingSchema(ogm,neo,value);registerGeneratedSchema(driver,value);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
function legacy():ChannelModerationRepository{const Issue=protectIssueModelIdentity(ogm.model('Issue'));const Channel=ogm.model('Channel');return{
 findChannel:uniqueName=>Channel.find({where:{uniqueName},selectionSet:'{uniqueName displayName locked Admins{username}}'}),
 findOpenIssues:uniqueName=>Issue.find({where:{channelUniqueName:null,relatedChannelUniqueName:uniqueName,isOpen:true},selectionSet:'{id issueNumber}'}),
 findRelatedIssues:uniqueName=>Issue.find({where:{channelUniqueName:null,relatedChannelUniqueName:uniqueName},selectionSet:'{id issueNumber isOpen}'}),
 createLockIssue:input=>Issue.create({input:[input],selectionSet:'{issues{id issueNumber}}'}),
 recordAction:async(id,update)=>{await Issue.update({where:{id},update});},
 updateLockState:(uniqueName,update)=>Channel.update({where:{uniqueName},update,selectionSet:'{channels{uniqueName displayName locked lockedAt lockReason LockedBy{displayName}}}'}),
};}
const context=()=>({user:{username:'alice',email:null,email_verified:true,data:{ModerationProfile:{displayName:'mod'}},dateOfBirth:null}} as GraphQLContext);
const args={channelUniqueName:'forum',reason:'Repeated spam'};const info=null as unknown as GraphQLResolveInfo;
async function seed(admins=2){await driver.executeQuery("CREATE(ch:Channel{uniqueName:'forum',displayName:'Forum',locked:false,createdAt:datetime('2020-01-01T00:00:00Z')}),(:ModerationProfile{displayName:'mod'}) WITH ch UNWIND range(1,$admins) AS n CREATE(u:User{username:'admin'+toString(n)}) CREATE(u)-[:ADMIN_OF_CHANNEL]->(ch)",{admins});}
const normalize=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const namespace=key==='id'&&this.event?.includes('relationship')?'relationship':'node';const identity=namespace+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','ageGateTouchedAt','lockedAt'].includes(key)?(value===null?null:'<time>'):value;}));};
async function state(){return{
 channel:normalize((await driver.executeQuery('MATCH(c:Channel) RETURN c.uniqueName AS name,c.locked AS locked,c.lockReason AS reason,c.lockedAt AS lockedAt')).records.map(r=>r.toObject())),
 issues:(await driver.executeQuery('MATCH(i:Issue) RETURN i.issueNumber AS n,i.isOpen AS open,i.channelUniqueName AS scope,i.relatedChannelUniqueName AS target ORDER BY n')).records.map(r=>({n:r.get('n').toNumber(),open:r.get('open'),scope:r.get('scope'),target:r.get('target')})),
 actions:(await driver.executeQuery('MATCH(i:Issue)-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)-[:MODERATED_COMMENT]->(c:Comment) RETURN a.actionType AS kind,c.text AS text ORDER BY kind,text')).records.map(r=>r.toObject()),
 notifications:(await driver.executeQuery('MATCH(u:User)-[:HAS_NOTIFICATION]->(n:Notification) RETURN u.username AS user,n.text AS text,n.read AS read,n.notificationType AS type ORDER BY user,text')).records.map(r=>r.toObject()),
 edges:(await driver.executeQuery('MATCH()-[r]->() RETURN type(r) AS type,count(*) AS n ORDER BY type')).records.map(r=>[r.get('type'),r.get('n').toNumber()]),events:normalize(events)};}
const outcome=async(call:()=>Promise<unknown>)=>{try{return{value:normalize(await call()),error:null};}catch(error){return{value:null,error:(error as Error).message};}};
test('full Issue action projection and channel-admin default cap match production OGM',async(t)=>{
 await seed(28);const repo=createChannelModerationRepository(driver);
 // Admins applies a default limit of 25 over 28; which 25 is only stable within a run, so snapshot
 // the channel with Admins reduced to a count and assert the cap separately.
 assert.equal((await repo.findChannel('forum'))[0].Admins?.length,25);const channelRows=normalize(await repo.findChannel('forum')) as any;channelRows[0].Admins=channelRows[0].Admins.length;t.assert.snapshot(channelRows);
 await driver.executeQuery("UNWIND range(1,28) AS n CREATE(:Issue{id:toString(n),issueNumber:n,isOpen:n%2=0,relatedChannelUniqueName:'forum'})");
 // findOpenIssues has no ORDER BY, so sort by the stable issueNumber before the
 // id-aliasing normalize — otherwise the alias assigned to each row depends on
 // Neo4j's row order and the snapshot is not reproducible across environments.
 t.assert.snapshot(normalize((await repo.findOpenIssues('forum')).sort((a,b)=>a.issueNumber-b.issueNumber)));
 // findRelatedIssues applies a default limit of 25 over 28; which 25 is only stable within a run,
 // so assert the limit directly rather than snapshotting an unstable subset.
 assert.equal((await repo.findRelatedIssues('forum')).length,25);
});
test('lock/unlock cycle preserves nested graph, raw notifications, native payloads and repeat guards',async(t)=>{
 async function run(repo:ChannelModerationRepository){await resetDatabase(driver);await seed(2);events=[];const lock=lockChannel({driver,channelModerationRepository:repo});const unlock=unlockChannel({driver,channelModerationRepository:repo});await lock(null,args,context(),info);await assert.rejects(lock(null,args,context(),info),/already locked/);await unlock(null,{...args,reason:'Resolved'},context(),info);await assert.rejects(unlock(null,args,context(),info),/not locked/);const result=await state();assert.equal(result.actions.length,2);assert.equal(result.notifications.length,4);assert.equal(result.issues[0].open,false);assert.equal(result.issues[0].scope,null);assert.equal(result.channel[0].locked,false);assert.ok(result.notifications.every(n=>n.read===false&&n.type==='moderation'));return result;}
 t.assert.snapshot(await run(createChannelModerationRepository(driver)));
});
test('supplied missing issue is not validated or replaced before locking',async(t)=>{
 async function run(repo:ChannelModerationRepository){await resetDatabase(driver);await seed();events=[];await lockChannel({driver,channelModerationRepository:repo})(null,{...args,issueId:'absent'},context(),info);return state();}
 const result=await run(createChannelModerationRepository(driver));assert.equal(result.issues.length,0);assert.equal(result.actions.length,0);assert.equal(result.channel[0].locked,true);assert.equal(result.notifications.length,2);t.assert.snapshot(result);
});
test('full default Issue projection failure is swallowed after action commits and channel changes',async(t)=>{
 async function run(repo:ChannelModerationRepository){await resetDatabase(driver);await seed();await driver.executeQuery("CREATE(:Issue{id:'issue',issueNumber:1,isOpen:true,relatedChannelUniqueName:'forum',locked:'invalid'})");events=[];await lockChannel({driver,channelModerationRepository:repo})(null,args,context(),info);return state();}
 const result=await run(createChannelModerationRepository(driver));assert.equal(result.actions.length,1);assert.equal(result.channel[0].locked,true);assert.equal(result.notifications.length,2);t.assert.snapshot(result);
});
test('channel response failure occurs after activity and lock commit but before notification',async(t)=>{
 await schema(true);try{async function run(repo:ChannelModerationRepository){await resetDatabase(driver);await seed();events=[];const result=await outcome(()=>lockChannel({driver,channelModerationRepository:repo})(null,args,context(),info));return{result,state:await state()};}
 const result=await run(createChannelModerationRepository(driver));assert.equal(result.result.error,'Error locking channel');assert.equal(result.state.actions.length,1);assert.equal(result.state.channel[0].locked,true);assert.equal(result.state.notifications.length,0);t.assert.snapshot(result);
 }finally{await schema();}
});
test('unlock closes a related already-closed issue and still adds the existing action',async(t)=>{
 async function run(repo:ChannelModerationRepository){await resetDatabase(driver);await seed();await driver.executeQuery("MATCH(c:Channel) SET c.locked=true CREATE(:Issue{id:'closed',issueNumber:1,isOpen:false,relatedChannelUniqueName:'forum'})");events=[];await unlockChannel({driver,channelModerationRepository:repo})(null,{channelUniqueName:'forum'},context(),info);return state();}
 const result=await run(createChannelModerationRepository(driver));assert.equal(result.actions.length,1);assert.equal(result.actions[0].text,'Channel unlocked');assert.equal(result.notifications.length,2);t.assert.snapshot(result);
});
