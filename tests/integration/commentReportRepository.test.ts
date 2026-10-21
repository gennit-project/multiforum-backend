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
import {createCommentReportRepository,type CommentReportRepository} from '../../services/persistence/commentReportRepository.js';
import {protectIssueModelIdentity} from '../../services/issueTargetIdentity.js';
import reportComment from '../../customResolvers/mutations/reportComment.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];
const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push({kind,event}));
async function schema(failProjection=false){const app=getCustomResolvers(driver);ogm=app.ogm;const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:failProjection?{...app.resolvers,Issue:{flaggedServerRuleViolation:()=>{throw Error('report projection failed');}}}:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const value=await neo.getSchema();initializeOgmFromExistingSchema(ogm,neo,value);registerGeneratedSchema(driver,value);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
function legacy():CommentReportRepository{const Issue=protectIssueModelIdentity(ogm.model('Issue'));return{
 findExisting:(channelUniqueName,commentId)=>Issue.find({where:{channelUniqueName,relatedCommentId:commentId},selectionSet:'{id issueNumber flaggedServerRuleViolation relatedUsername relatedModProfileName}'}),
 findComment:commentId=>ogm.model('Comment').find({where:{id:commentId},selectionSet:'{id text CommentAuthor{__typename ...on User{username} ...on ModerationProfile{displayName}}}'}),
 createIssue:input=>Issue.create({input:[input],selectionSet:'{issues{id issueNumber flaggedServerRuleViolation}}'}),
 appendReport:(where,update)=>Issue.update({where,update,selectionSet:'{issues{id issueNumber flaggedServerRuleViolation}}'}),
};}
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
test('comment report reads preserve filters, implicit limit and quoted data',async()=>{
 await driver.executeQuery("UNWIND range(1,28) AS n CREATE(:Issue{id:toString(n),issueNumber:n,channelUniqueName:'forum',relatedCommentId:'event'})");
 const repo=createCommentReportRepository(driver);assert.deepEqual(await repo.findExisting('forum','event'),await legacy().findExisting('forum','event'));assert.equal((await repo.findExisting('forum','event')).length,25);
 await driver.executeQuery('CREATE(:Comment{id:$id,text:$title,isRootComment:true,createdAt:datetime()})',{id:'quote"\\id',title:'quoted'});assert.deepEqual(await repo.findComment('quote"\\id'),await legacy().findComment('quote"\\id'));assert.deepEqual(await repo.findExisting('missing','event'),[]);
});
test('real resolver preserves identity, numbering, repeated activity, reopen and native payloads',async()=>{
 async function run(repo:CommentReportRepository){await resetDatabase(driver);await seed();events=[];const resolve=reportComment({driver,commentReportRepository:repo});const first=await resolve(null,args,context(),null as unknown as GraphQLResolveInfo);await driver.executeQuery('MATCH(i:Issue) SET i.isOpen=false');await resolve(null,{...args,selectedServerRules:['No spam']},context(),null as unknown as GraphQLResolveInfo);const snapshot=await state();assert.equal(snapshot.issues.length,1);assert.equal(snapshot.issues[0].flagged,true);assert.equal(snapshot.issues[0].open,true);assert.equal(snapshot.comments.length,2);assert.deepEqual(snapshot.counter,[1]);assert.ok(snapshot.edges.some(([type,n])=>type==='TARGETS_COMMENT'&&n===1));assert.ok(snapshot.events.length>0);return {first:normalize(first),snapshot};}
 assert.deepEqual(await run(createCommentReportRepository(driver)),await run(legacy()));
});
test('missing comment retains empty-context issue creation and separate activity writes',async()=>{
 async function run(repo:CommentReportRepository){await resetDatabase(driver);await seed();events=[];await reportComment({driver,commentReportRepository:repo})(null,{...args,commentId:'absent'},context(),null as unknown as GraphQLResolveInfo);return state();}
 const old=await run(legacy());assert.equal(old.issues.length,1);assert.equal(old.comments.length,1);assert.deepEqual(await run(createCommentReportRepository(driver)),old);
});
test('identity guard and generated input errors retain no writes',async()=>{
 await seed();for(const input of [{issueNumber:1,channelUniqueName:'forum',authorName:'mismatch',Author:{ModerationProfile:{connect:{where:{node:{displayName:'mod'}}}}}},{issueNumber:1,channelUniqueName:'forum',isOpen:'bad'}]){
 const old=await outcome(()=>legacy().createIssue(input as never));assert.ok(old.error);assert.deepEqual(await outcome(()=>createCommentReportRepository(driver).createIssue(input as never)),old);
 }
 const old=await outcome(()=>legacy().appendReport({id:'none'},{relatedCommentId:'other'} as never));assert.ok(old.error);assert.deepEqual(await outcome(()=>createCommentReportRepository(driver).appendReport({id:'none'},{relatedCommentId:'other'} as never)),old);assert.equal((await state()).issues.length,0);
});
for(const existing of [false,true])test(`projection failure preserves committed ${existing?'activity':'creation'} and exact catch contract`,async()=>{
 await schema(true);
 try{
 async function run(repo:CommentReportRepository){await resetDatabase(driver);await seed();if(existing)await driver.executeQuery("CREATE(:Issue{id:'existing',issueNumber:9,channelUniqueName:'forum',relatedCommentId:'event'})");events=[];
 // Avoid the failing projection only in the pre-write read so both persistence paths reach their identical selected write projection.
 const wrapped={...repo,findExisting:async()=>existing?[{id:'existing',issueNumber:9,flaggedServerRuleViolation:false}]:[]};
 const result=await outcome(()=>reportComment({driver,commentReportRepository:wrapped})(null,args,context(),null as unknown as GraphQLResolveInfo));return{result,state:await state()};}
 const old=await run(legacy());assert.equal(old.result.error,existing?'Error updating issue':'Error creating issue');assert.equal(old.state.issues.length,1);assert.equal(old.state.comments.length,existing?1:0);assert.deepEqual(await run(createCommentReportRepository(driver)),old);
 }finally{await schema();}
});

test('comment report retains target account identity for both author union variants',async()=>{
 for(const mod of [false,true]){
  async function run(repo:CommentReportRepository){await resetDatabase(driver);await seed();if(mod)await driver.executeQuery("MATCH(:User)-[r:AUTHORED_COMMENT]->(c:Comment{id:'event'}), (m:ModerationProfile{displayName:'mod'}) DELETE r CREATE(m)-[:AUTHORED_COMMENT]->(c)");events=[];await reportComment({driver,commentReportRepository:repo} as never)(null,args,context(),null as unknown as GraphQLResolveInfo);return state();}
  const old=await run(legacy());assert.ok(old.edges.some(([kind,n])=>kind===(mod?'TARGETS_MOD_PROFILE':'TARGETS_USER')&&n===1));assert.deepEqual(await run(createCommentReportRepository(driver)),old);
 }
});
