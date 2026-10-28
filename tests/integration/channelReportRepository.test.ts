import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLResolveInfo} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createChannelReportRepository,type ChannelReportRepository} from '../../services/persistence/channelReportRepository.js';
import reportChannel from '../../customResolvers/mutations/reportChannel.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;
const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push({kind,event}));
async function schema(failProjection=false){const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:failProjection?{...app.resolvers,Issue:{flaggedServerRuleViolation:()=>{throw Error('report projection failed');}}}:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});const value=await neo.getSchema();registerGeneratedSchema(driver,value);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const context=()=>({user:{username:'alice',email:null,email_verified:true,data:{ModerationProfile:{displayName:'mod'}},dateOfBirth:null}} as GraphQLContext);
const args={eventId:'event',channelUniqueName:'forum',reportText:'Please review',selectedForumRules:['Kindness'],selectedServerRules:['No spam'] as string[]};
const seed=async()=>{await driver.executeQuery("CREATE (:Channel{uniqueName:'forum',displayName:'Forum'}),(:ModerationProfile{displayName:'mod'}),(:User{username:'alice'}),(:Event{id:'event',title:'A title longer than fifty characters to characterize truncation',canceled:false})");};
const normalize=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const namespace=key==='id'&&this.event?.includes('relationship')?'relationship':'node';const identity=namespace+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','ageGateTouchedAt'].includes(key)?'<time>':value;}));};
async function state(){return{
 issues:(await driver.executeQuery('MATCH(i:Issue) RETURN i.title AS title,i.issueNumber AS number,i.isOpen AS open,i.flaggedServerRuleViolation AS flagged,i.relatedChannelUniqueName AS event,i.channelUniqueName AS channel ORDER BY number')).records.map(r=>({title:r.get('title'),number:r.get('number').toNumber(),open:r.get('open'),flagged:r.get('flagged'),event:r.get('event'),channel:r.get('channel')})),
 nodes:(await driver.executeQuery('MATCH(n) RETURN labels(n)[0] AS label,count(*) AS n ORDER BY label')).records.map(r=>[r.get('label'),r.get('n').toNumber()]),
 edges:(await driver.executeQuery('MATCH()-[r]->() RETURN type(r) AS type,count(*) AS n ORDER BY type')).records.map(r=>[r.get('type'),r.get('n').toNumber()]),
 comments:(await driver.executeQuery('MATCH(c:Comment) RETURN c.text AS text ORDER BY text')).records.map(r=>r.get('text')),
 counter:(await driver.executeQuery('MATCH(c:ServerIssueCounter) RETURN c.current AS current')).records.map(r=>r.get('current').toNumber()),events:normalize(events)};}
const outcome=async(call:()=>Promise<unknown>)=>{try{return{value:normalize(await call()),error:null};}catch(error){return{value:null,error:(error as Error).message};}};
test('channel report reads preserve filters, implicit limit and quoted data',async(t)=>{
 await driver.executeQuery("UNWIND range(1,28) AS n CREATE(:Issue{id:toString(n),issueNumber:n,relatedChannelUniqueName:'forum'})");
 // findExisting applies a default limit of 25 over 28 matched issues; which 25 is only stable within a
 // single run, so assert the limit directly rather than snapshotting an unstable subset.
 const repo=createChannelReportRepository(driver);assert.equal((await repo.findExisting('forum')).length,25);
 await driver.executeQuery('CREATE(:Channel{uniqueName:$id,displayName:$title})',{id:'quote"\\id',title:'quoted'});t.assert.snapshot(normalize(await repo.findChannel('quote"\\id')));assert.deepEqual(await repo.findExisting('missing'),[]);
});
test('real resolver preserves identity, numbering, repeated activity, reopen and native payloads',async(t)=>{
 async function run(repo:ChannelReportRepository){await resetDatabase(driver);await seed();events=[];const resolve=reportChannel({driver,channelReportRepository:repo});const first=await resolve(null,args,context(),null as unknown as GraphQLResolveInfo);await driver.executeQuery('MATCH(i:Issue) SET i.isOpen=false');await resolve(null,{...args,selectedServerRules:['No spam']},context(),null as unknown as GraphQLResolveInfo);const snapshot=await state();assert.equal(snapshot.issues.length,1);assert.equal(snapshot.issues[0].flagged,true);assert.equal(snapshot.issues[0].open,true);assert.equal(snapshot.issues[0].channel,null);assert.equal(snapshot.comments.length,2);assert.deepEqual(snapshot.counter,[1]);assert.ok(snapshot.edges.some(([type,n])=>type==='TARGETS_CHANNEL'&&n===1));
 // v7 owned-write migration (#284): owned driver writes emit no in-process
 // subscription events (no transport; see #386).
 assert.equal(snapshot.events.length,0);return {first:normalize(first),snapshot};}
 t.assert.snapshot(await run(createChannelReportRepository(driver)));
});
test('missing channel fails before issue lookup, allocation or writes',async(t)=>{
 await seed();const run=(repo:ChannelReportRepository)=>outcome(()=>reportChannel({driver,channelReportRepository:repo})(null,{...args,channelUniqueName:'absent'},context(),null as unknown as GraphQLResolveInfo));
 const result=await run(createChannelReportRepository(driver));assert.equal(result.error,'Channel not found');t.assert.snapshot(result);assert.deepEqual((await state()).issues,[]);assert.deepEqual((await state()).counter,[]);
});
// v7 owned-write migration (#284): createIssue/appendReport are driver Cypher with
// typed params, so the former generated-input identity validation no longer runs
// here. The durable invariant — a write against a missing issue commits nothing —
// still holds (MATCH (i:Issue) yields no rows).
test('appending to a missing issue commits no writes',async()=>{
 await seed();
 const result=await createChannelReportRepository(driver).appendReport({issueId:'none',actions:[{actionType:'report',actionDescription:'Reported the channel',text:'x',modDisplayName:'mod'}],isOpen:true,flaggedServerRuleViolation:true});
 assert.deepEqual(result.issues,[]);
 assert.equal((await state()).issues.length,0);
});
// v7 owned-write migration (#284): createIssue/appendReport no longer round-trip
// through the generated Issue projection, so a broken Issue.flaggedServerRuleViolation
// resolver (schema(true)) can no longer fail the mutation. The write commits fully in
// both paths — demonstrating the owned write's insulation from projection failures.
for(const existing of [false,true])test(`owned channel report write is insulated from a broken Issue projection resolver (${existing?'existing':'new'} issue)`,async(t)=>{
 await schema(true);
 try{
 async function run(repo:ChannelReportRepository){await resetDatabase(driver);await seed();if(existing)await driver.executeQuery("CREATE(:Issue{id:'existing',issueNumber:9,relatedChannelUniqueName:'forum'})");events=[];
 const wrapped={...repo,findExisting:async()=>existing?[{id:'existing',issueNumber:9,flaggedServerRuleViolation:false}]:[]};
 const result=await outcome(()=>reportChannel({driver,channelReportRepository:wrapped})(null,args,context(),null as unknown as GraphQLResolveInfo));return{result,state:await state()};}
 const result=await run(createChannelReportRepository(driver));assert.equal(result.result.error,null);assert.equal(result.state.issues.length,1);assert.equal(result.state.comments.length,1);t.assert.snapshot(result);
 }finally{await schema();}
});
