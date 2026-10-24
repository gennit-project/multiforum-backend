import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLResolveInfo} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createCommentReportRepository,type CommentReportRepository} from '../../services/persistence/commentReportRepository.js';
import reportComment from '../../customResolvers/mutations/reportComment.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;
const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push({kind,event}));
async function schema(failProjection=false){const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:failProjection?{...app.resolvers,Issue:{flaggedServerRuleViolation:()=>{throw Error('report projection failed');}}}:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});const value=await neo.getSchema();registerGeneratedSchema(driver,value);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const context=()=>({user:{username:'alice',email:null,email_verified:true,data:{ModerationProfile:{displayName:'mod'}},dateOfBirth:null}} as GraphQLContext);
const args={commentId:'event',channelUniqueName:'forum',reportText:'Please review',selectedForumRules:['Kindness'],selectedServerRules:[] as string[]};
const seed=async()=>{await driver.executeQuery("CREATE (:Channel{uniqueName:'forum'}),(:ModerationProfile{displayName:'mod'}),(u:User{username:'alice'}),(c:Comment{id:'event',text:'A text longer than fifty characters to characterize truncation',isRootComment:true,createdAt:datetime()}) CREATE(u)-[:AUTHORED_COMMENT]->(c)");};
const normalize=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const namespace=key==='id'&&this.event?.includes('relationship')?'relationship':'node';const identity=namespace+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','ageGateTouchedAt'].includes(key)?'<time>':value;}));};
async function state(){return{
 issues:(await driver.executeQuery('MATCH(i:Issue) RETURN i.title AS title,i.issueNumber AS number,i.isOpen AS open,i.flaggedServerRuleViolation AS flagged,i.relatedCommentId AS event,i.channelUniqueName AS channel ORDER BY number')).records.map(r=>({title:r.get('title'),number:r.get('number').toNumber(),open:r.get('open'),flagged:r.get('flagged'),event:r.get('event'),channel:r.get('channel')})),
 nodes:(await driver.executeQuery('MATCH(n) RETURN labels(n)[0] AS label,count(*) AS n ORDER BY label')).records.map(r=>[r.get('label'),r.get('n').toNumber()]),
 edges:(await driver.executeQuery('MATCH()-[r]->() RETURN type(r) AS type,count(*) AS n ORDER BY type')).records.map(r=>[r.get('type'),r.get('n').toNumber()]),
 comments:(await driver.executeQuery('MATCH(c:Comment) WHERE c.id <> "event" RETURN c.text AS text ORDER BY text')).records.map(r=>r.get('text')),
 counter:(await driver.executeQuery('MATCH(c:ChannelIssueCounter) RETURN c.current AS current')).records.map(r=>r.get('current').toNumber()),events:normalize(events)};}
const outcome=async(call:()=>Promise<unknown>)=>{try{return{value:normalize(await call()),error:null};}catch(error){return{value:null,error:(error as Error).message};}};
test('comment report reads preserve filters, implicit limit and quoted data',async(t)=>{
 await driver.executeQuery("UNWIND range(1,28) AS n CREATE(:Issue{id:toString(n),issueNumber:n,channelUniqueName:'forum',relatedCommentId:'event'})");
 // findExisting applies a default limit of 25 over 28 matched issues; which 25 is only stable within a
 // single run, so assert the limit directly rather than snapshotting an unstable subset.
 const repo=createCommentReportRepository(driver);assert.equal((await repo.findExisting('forum','event')).length,25);
 await driver.executeQuery('CREATE(:Comment{id:$id,text:$title,isRootComment:true,createdAt:datetime()})',{id:'quote"\\id',title:'quoted'});t.assert.snapshot(normalize(await repo.findComment('quote"\\id')));assert.deepEqual(await repo.findExisting('missing','event'),[]);
});
test('real resolver preserves identity, numbering, repeated activity, reopen and native payloads',async(t)=>{
 async function run(repo:CommentReportRepository){await resetDatabase(driver);await seed();events=[];const resolve=reportComment({driver,commentReportRepository:repo});const first=await resolve(null,args,context(),null as unknown as GraphQLResolveInfo);await driver.executeQuery('MATCH(i:Issue) SET i.isOpen=false');await resolve(null,{...args,selectedServerRules:['No spam']},context(),null as unknown as GraphQLResolveInfo);const snapshot=await state();assert.equal(snapshot.issues.length,1);assert.equal(snapshot.issues[0].flagged,true);assert.equal(snapshot.issues[0].open,true);assert.equal(snapshot.comments.length,2);assert.deepEqual(snapshot.counter,[1]);assert.ok(snapshot.edges.some(([type,n])=>type==='TARGETS_COMMENT'&&n===1));
 // v7 owned-write migration (campaign #284): the issue/action/comment write is now
 // driver Cypher, which bypasses the in-process @neo4j/graphql subscription engine
 // (publish() only fires from generated mutations), so no subscription events are
 // emitted. This is the accepted behaviour: the app ships no subscription transport,
 // so no client is affected. Real-time delivery (WebSocket + CDC, which would capture
 // owned writes) is tracked separately in gennit-project/multiforum-backend#386.
 assert.equal(snapshot.events.length,0);return {first:normalize(first),snapshot};}
 t.assert.snapshot(await run(createCommentReportRepository(driver)));
});
test('missing comment retains empty-context issue creation and separate activity writes',async(t)=>{
 async function run(repo:CommentReportRepository){await resetDatabase(driver);await seed();events=[];await reportComment({driver,commentReportRepository:repo})(null,{...args,commentId:'absent'},context(),null as unknown as GraphQLResolveInfo);return state();}
 const result=await run(createCommentReportRepository(driver));assert.equal(result.issues.length,1);assert.equal(result.comments.length,1);t.assert.snapshot(result);
});
// v7 owned-write migration (campaign #284): createIssue/appendReport are driver
// Cypher taking typed params, so the former attachIssueIdentityRelationships
// generated-input identity validation no longer runs here (input shape is now
// enforced by the types + the resolver). The durable invariant — a write against
// a missing issue commits nothing — still holds (MATCH (i:Issue) yields no rows).
test('appending to a missing issue commits no writes',async()=>{
 await seed();
 const result=await createCommentReportRepository(driver).appendReport({issueId:'none',actions:[{actionType:'report',actionDescription:'Reported the comment',text:'x',modDisplayName:'mod',commentChannelUniqueName:'forum'}],isOpen:true,flaggedServerRuleViolation:false});
 assert.deepEqual(result.issues,[]);
 const after=await state();assert.equal(after.issues.length,0);assert.equal(after.comments.length,0);
});
// v7 owned-write migration: createIssue/appendReport no longer round-trip through
// the generated Issue projection, so a broken Issue.flaggedServerRuleViolation
// resolver (schema(true)) can no longer fail the mutation. The write commits
// fully in both paths — issue created/reused and the report activity + comment
// persist — demonstrating the owned write's insulation from projection failures.
for(const existing of [false,true])test(`owned report write is insulated from a broken Issue projection resolver (${existing?'existing':'new'} issue)`,async(t)=>{
 await schema(true);
 try{
 async function run(repo:CommentReportRepository){await resetDatabase(driver);await seed();if(existing)await driver.executeQuery("CREATE(:Issue{id:'existing',issueNumber:9,channelUniqueName:'forum',relatedCommentId:'event'})");events=[];
 const wrapped={...repo,findExisting:async()=>existing?[{id:'existing',issueNumber:9,flaggedServerRuleViolation:false}]:[]};
 const result=await outcome(()=>reportComment({driver,commentReportRepository:wrapped})(null,args,context(),null as unknown as GraphQLResolveInfo));return{result,state:await state()};}
 const result=await run(createCommentReportRepository(driver));assert.equal(result.result.error,null);assert.equal(result.state.issues.length,1);assert.equal(result.state.comments.length,1);t.assert.snapshot(result);
 }finally{await schema();}
});

test('comment report retains target account identity for both author union variants',async(t)=>{
 for(const mod of [false,true]){
  async function run(repo:CommentReportRepository){await resetDatabase(driver);await seed();if(mod)await driver.executeQuery("MATCH(:User)-[r:AUTHORED_COMMENT]->(c:Comment{id:'event'}), (m:ModerationProfile{displayName:'mod'}) DELETE r CREATE(m)-[:AUTHORED_COMMENT]->(c)");events=[];await reportComment({driver,commentReportRepository:repo} as never)(null,args,context(),null as unknown as GraphQLResolveInfo);return state();}
  const result=await run(createCommentReportRepository(driver));assert.ok(result.edges.some(([kind,n])=>kind===(mod?'TARGETS_MOD_PROFILE':'TARGETS_USER')&&n===1));t.assert.snapshot(result);
 }
});
