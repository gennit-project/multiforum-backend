import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLSchema,GraphQLObjectType} from 'graphql';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import {createBotReport} from '../../services/botReportService.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import * as persistence from '../../services/persistence/botReportRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let app:ReturnType<typeof getCustomResolvers>;let schema:GraphQLSchema;let events:any[]=[];const engine=createSubscriptionEngine();
for(const kind of ['update','create','create_relationship','delete_relationship'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=await startNeo4j();app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});schema=await neo.getSchema();registerGeneratedSchema(driver,schema);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const identity={findIdentity:async()=>[{username:'bot-forum-helper',isBot:true,botProfileId:null,isDeprecated:false,deprecatedReason:null}] as any,createIdentity:async()=>{throw Error('unexpected identity create');},reactivateIdentity:async()=>{throw Error('unexpected identity update');},findChannelBots:async()=>[{uniqueName:'forum',Bots:[{username:'bot-forum-helper'}]}] as any,connectBot:async()=>{throw Error('unexpected identity connect');},disconnectBots:async()=>{throw Error('unexpected identity disconnect');}};
const graph=async()=>({nodes:(await driver.executeQuery('MATCH(n) RETURN toString(id(n)) AS identity,labels(n)[0] AS label,properties(n) AS properties')).records.map(r=>r.toObject()),edges:(await driver.executeQuery('MATCH(a)-[r]->(b) RETURN toString(id(r)) AS identity,toString(id(a)) AS source,toString(id(b)) AS target,type(r) AS type,properties(r) AS properties')).records.map(r=>r.toObject())});
async function seed(kind:string,existing:boolean){await driver.executeQuery("CREATE(:Channel{uniqueName:'forum'}),(:ModerationProfile{displayName:'bot-forum-helper'}),(u:User{username:'alice'}),(m:ModerationProfile{displayName:'human-mod'})");if(kind==='comment'||kind==='mod-comment')await driver.executeQuery("MATCH(a) WHERE (a:User AND a.username='alice' AND $kind='comment') OR (a:ModerationProfile AND a.displayName='human-mod' AND $kind='mod-comment') CREATE(a)-[:AUTHORED_COMMENT]->(:Comment{id:'content',text:'Reported text',isRootComment:true,createdAt:datetime()})",{kind});if(kind==='discussion')await driver.executeQuery("MATCH(u:User{username:'alice'}) CREATE(u)-[:POSTED_DISCUSSION]->(:Discussion{id:'content',title:'Reported title'})");if(kind==='event')await driver.executeQuery("MATCH(u:User{username:'alice'}) CREATE(u)-[:POSTED_BY]->(:Event{id:'content',title:'Reported event'})");if(existing)await driver.executeQuery("CREATE(i:Issue{id:'existing',channelUniqueName:'forum',issueNumber:7,isOpen:false,flaggedServerRuleViolation:true}) SET i[$key]='content', i.relatedUsername='alice'",{key:kind==='discussion'?'relatedDiscussionId':kind==='event'?'relatedEventId':'relatedCommentId'});}
for(const [kind,existing,failure] of [['comment',false,''],['mod-comment',false,''],['discussion',false,''],['event',false,''],['missing',false,''],['comment',true,''],['discussion',true,''],['event',true,'']] as const)test(`actual bot report parity ${kind}/${existing?'existing':'new'}/${failure||'success'}`,async(t)=>{
 // v7 owned-write migration (#284): the former failure variants ('create'/'append')
 // injected a generated Issue-projection error to test partial-write boundaries.
 // Owned Cypher writes do not round-trip through that projection, so those failure
 // modes no longer exist — only the success variants remain.
 const field=(schema.getType('Issue') as GraphQLObjectType).getFields().flaggedServerRuleViolation;const original=field.resolve;let fail=false;field.resolve=(source,args,context,info)=>{if(fail)throw Error('fixture projection failure');return original?original(source,args,context,info):source.flaggedServerRuleViolation;};
 try{for(const raw of [persistence.createBotReportRepository(driver)]){
  fail=false;await resetDatabase(driver);await seed(kind,existing);events=[];
  const repo={...raw,createReportedIssue:async(input:any)=>{fail=failure==='create';return raw.createReportedIssue(input);},appendBotReport:async(where:any,update:any)=>{fail=failure==='append';return raw.appendBotReport(where,update);}};
  const contentType=kind==='discussion'||kind==='event'?kind:'comment';let response:unknown,error:string|null=null;
  try{response=await createBotReport({driver,botIdentityRepository:identity,botReportRepository:repo,channelUniqueName:'forum',reportInput:{contentType,contentId:'content',reportText:'Please review',selectedForumRules:['Kindness'],selectedServerRules:[],botName:'helper'}});}catch(e){error=(e as Error).message;}
  // relatedUsername/relatedModProfileName are set at issue creation and are
  // @settable(onUpdate:false); the append-report update no longer carries them,
  // so a new-issue report succeeds (only the injected fixture failures error).
  assert.equal(error,failure?`Error ${failure==='create'?'creating':'updating'} issue: fixture projection failure`:null);
  const state=await graph();const node=(id:string)=>{const n=state.nodes.find(n=>n.identity===id);assert.ok(n);return n;};
  const alias=(id:string)=>{const n=node(id),p=n.properties;return n.label+':'+(p.username??p.displayName??p.uniqueName??p.text??p.title??p.actionDescription??p.channelUniqueName);};
  assert.equal(new Set(state.nodes.map(n=>alias(n.identity))).size,state.nodes.length);
  for(const n of state.nodes)for(const key of ['createdAt','updatedAt','ageGateTouchedAt'])if(n.properties[key])assert.match(n.properties[key].toString(),/^\d{4}-\d{2}-\d{2}T/);
  const ids=new Map(state.nodes.filter(n=>n.properties.id).map(n=>[n.properties.id,alias(n.identity)]));
  for(const e of events){assert.ok(e.timestamp>0);if(e.event.includes('relationship')){const r=state.edges.find(r=>r.identity===e.id);assert.ok(r);assert.equal(e.id_from,r.source);assert.equal(e.id_to,r.target);assert.equal(e.relationshipName,r.type);}else{const n=node(e.id);assert.equal(e.typename,n.label);assert.equal(e.properties.new.id,n.properties.id);}}
  const issue=state.nodes.find(n=>n.label==='Issue')!;assert.ok(issue);assert.equal(state.nodes.filter(n=>n.label==='ModerationAction').length,failure==='create'?0:1);
  if(kind==='discussion'||kind==='event'||kind==='comment')assert.equal(issue.properties.relatedUsername,'alice');
  if(kind==='mod-comment')assert.equal(issue.properties.relatedModProfileName,'human-mod');
  const result=JSON.parse(JSON.stringify({response,error,events,nodes:state.nodes.map(n=>({alias:alias(n.identity),properties:n.properties})).sort((a,b)=>a.alias.localeCompare(b.alias)),edges:state.edges.map(r=>({source:alias(r.source),target:alias(r.target),type:r.type,properties:r.properties})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))},function(key,value){if(this.event&&['id','id_from','id_to'].includes(key)){if(key==='id'&&this.event.includes('relationship')){const r=state.edges.find(r=>r.identity===value)!;return r.type+':'+alias(r.source)+':'+alias(r.target);}return alias(value);}if(['timestamp','createdAt','updatedAt','ageGateTouchedAt'].includes(key))return '<time>';return typeof value==='string'&&ids.has(value)?ids.get(value):value;}));
  t.assert.snapshot(result);
 }}finally{field.resolve=original;}
});
test('missing rows, literal filters and generated coercion retain behavior',async()=>{const next=persistence.createBotReportRepository(driver);for(const repo of [next]){assert.deepEqual(await repo.findReportedComment('quote"\\'),[]);assert.deepEqual(await repo.findReportedDiscussion('missing'),[]);assert.deepEqual(await repo.findReportedEvent('missing'),[]);assert.deepEqual(await repo.findExistingReport({channelUniqueName:{eq:'quote"\\'}}),[]);}
 // v7 owned-write migration (#284): createReportedIssue is owned Cypher; a params
 // object missing the required issueNumber is rejected by the driver (not the
 // generated Int! validation), and still commits no writes.
 await assert.rejects(async()=>next.createReportedIssue([{title:123,relatedCommentId:'missing'}] as never));assert.deepEqual(await graph(),{nodes:[],edges:[]});});
