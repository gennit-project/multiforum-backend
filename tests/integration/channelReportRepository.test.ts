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
import {createChannelReportRepository,type ChannelReportRepository} from '../../services/persistence/channelReportRepository.js';
import {protectIssueModelIdentity} from '../../services/issueTargetIdentity.js';
import reportChannel from '../../customResolvers/mutations/reportChannel.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];
const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push({kind,event}));
async function schema(failProjection=false){const app=getCustomResolvers(driver);ogm=app.ogm;const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:failProjection?{...app.resolvers,Issue:{flaggedServerRuleViolation:()=>{throw Error('report projection failed');}}}:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const value=await neo.getSchema();initializeOgmFromExistingSchema(ogm,neo,value);registerGeneratedSchema(driver,value);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
function legacy():ChannelReportRepository{const Issue=protectIssueModelIdentity(ogm.model('Issue'));return{
 findExisting:channelUniqueName=>Issue.find({where:{channelUniqueName:null,relatedChannelUniqueName:channelUniqueName},selectionSet:'{id issueNumber flaggedServerRuleViolation}'}),
 findChannel:uniqueName=>ogm.model('Channel').find({where:{uniqueName},selectionSet:'{uniqueName displayName}'}),
 createIssue:input=>Issue.create({input:[input],selectionSet:'{issues{id issueNumber flaggedServerRuleViolation}}'}),
 appendReport:(where,update)=>Issue.update({where,update,selectionSet:'{issues{id issueNumber flaggedServerRuleViolation relatedChannelUniqueName}}'}),
};}
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
test('channel report reads preserve filters, implicit limit and quoted data',async()=>{
 await driver.executeQuery("UNWIND range(1,28) AS n CREATE(:Issue{id:toString(n),issueNumber:n,relatedChannelUniqueName:'forum'})");
 const repo=createChannelReportRepository(driver);assert.deepEqual(await repo.findExisting('forum'),await legacy().findExisting('forum'));assert.equal((await repo.findExisting('forum')).length,25);
 await driver.executeQuery('CREATE(:Channel{uniqueName:$id,displayName:$title})',{id:'quote"\\id',title:'quoted'});assert.deepEqual(await repo.findChannel('quote"\\id'),await legacy().findChannel('quote"\\id'));assert.deepEqual(await repo.findExisting('missing'),[]);
});
test('real resolver preserves identity, numbering, repeated activity, reopen and native payloads',async()=>{
 async function run(repo:ChannelReportRepository){await resetDatabase(driver);await seed();events=[];const resolve=reportChannel({driver,channelReportRepository:repo});const first=await resolve(null,args,context(),null as unknown as GraphQLResolveInfo);await driver.executeQuery('MATCH(i:Issue) SET i.isOpen=false');await resolve(null,{...args,selectedServerRules:['No spam']},context(),null as unknown as GraphQLResolveInfo);const snapshot=await state();assert.equal(snapshot.issues.length,1);assert.equal(snapshot.issues[0].flagged,true);assert.equal(snapshot.issues[0].open,true);assert.equal(snapshot.issues[0].channel,null);assert.equal(snapshot.comments.length,2);assert.deepEqual(snapshot.counter,[1]);assert.ok(snapshot.edges.some(([type,n])=>type==='TARGETS_CHANNEL'&&n===1));assert.ok(snapshot.events.length>0);return {first:normalize(first),snapshot};}
 assert.deepEqual(await run(createChannelReportRepository(driver)),await run(legacy()));
});
test('missing channel fails before issue lookup, allocation or writes',async()=>{
 await seed();const run=(repo:ChannelReportRepository)=>outcome(()=>reportChannel({driver,channelReportRepository:repo})(null,{...args,channelUniqueName:'absent'},context(),null as unknown as GraphQLResolveInfo));
 const old=await run(legacy());assert.equal(old.error,'Channel not found');assert.deepEqual(await run(createChannelReportRepository(driver)),old);assert.deepEqual((await state()).issues,[]);assert.deepEqual((await state()).counter,[]);
});
test('identity guard and generated input errors retain no writes',async()=>{
 await seed();const cases:[any,RegExp][]=[[{issueNumber:1,channelUniqueName:'forum',authorName:'mismatch',Author:{ModerationProfile:{connect:{where:{node:{displayName:'mod'}}}}}},/immutable author snapshot/],[{issueNumber:1,channelUniqueName:'forum',isOpen:'bad'},/Issue author identity is required/]];
 for(const [input,message] of cases){
 await assert.rejects(createChannelReportRepository(driver).createIssue(input as never),message);
 }
 await assert.rejects(createChannelReportRepository(driver).appendReport({id:'none'},{relatedChannelUniqueName:'other'} as never),/Issue identity cannot be updated/);assert.equal((await state()).issues.length,0);
});
for(const existing of [false,true])test(`projection failure preserves committed ${existing?'activity':'creation'} and exact catch contract`,async()=>{
 await schema(true);
 try{
 async function run(repo:ChannelReportRepository){await resetDatabase(driver);await seed();if(existing)await driver.executeQuery("CREATE(:Issue{id:'existing',issueNumber:9,relatedChannelUniqueName:'forum'})");events=[];
 // Avoid the failing projection only in the pre-write read so both persistence paths reach their identical selected write projection.
 const wrapped={...repo,findExisting:async()=>existing?[{id:'existing',issueNumber:9,flaggedServerRuleViolation:false}]:[]};
 const result=await outcome(()=>reportChannel({driver,channelReportRepository:wrapped})(null,args,context(),null as unknown as GraphQLResolveInfo));return{result,state:await state()};}
 const old=await run(legacy());assert.equal(old.result.error,existing?'Error updating issue':'Error creating issue: report projection failed');assert.equal(old.state.issues.length,1);assert.equal(old.state.comments.length,existing?1:0);assert.deepEqual(await run(createChannelReportRepository(driver)),old);
 }finally{await schema();}
});
