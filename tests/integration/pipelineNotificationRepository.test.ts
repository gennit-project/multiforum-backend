import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineNotificationRepository,PIPELINE_NOTIFICATION_ATTEMPT_SELECTION,PIPELINE_NOTIFICATION_FILE_SELECTION,type PipelineNotificationRepository} from '../../services/persistence/pipelineNotificationRepository.js';
import {notifyUploaderOfPipelineResult} from '../../services/plugin/pipelineNotifications.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
async function schema(fail=false){const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:fail?{...app.resolvers,User:{displayName:()=>{throw Error('notification projection failed');}}}:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const executable=await neo.getSchema();ogm=app.ogm;initializeOgmFromExistingSchema(ogm,neo,executable);registerGeneratedSchema(driver,executable);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
function legacy():PipelineNotificationRepository{return{
 findAttempt:pipelineId=>ogm.model('PluginPipelineRun').find({where:{pipelineId},selectionSet:PIPELINE_NOTIFICATION_ATTEMPT_SELECTION}),
 findTargetFile:id=>ogm.model('DownloadableFile').find({where:{id},selectionSet:PIPELINE_NOTIFICATION_FILE_SELECTION}),
 claimNotification:(pipelineId,notifiedAt)=>ogm.model('PluginPipelineRun').update({where:{pipelineId,notifiedAt:null},update:{notifiedAt},selectionSet:'{pluginPipelineRuns{pipelineId}}'}),
 createNotification:async input=>{await ogm.model('User').update(input);},
};}
const now=()=> '2026-07-30T12:00:00.000Z';
async function seed(status='SUCCEEDED',uploader=true){await driver.executeQuery(`CREATE(u:User{username:'owner',createdAt:datetime()}),(d:Discussion{id:'discussion / "',title:'Fixture',createdAt:datetime()}),(f:DownloadableFile{id:'file',uploadedByUsername:$uploader}),(c:DiscussionChannel{channelUniqueName:'forum / "',archived:false}),(p:PluginPipelineRun{id:'attempt',pipelineId:'pipeline / "',targetId:'file',targetType:'DownloadableFile',status:$status}) CREATE(u)-[:POSTED_DISCUSSION]->(d),(d)-[:HAS_DOWNLOADABLE_FILE]->(f),(c)-[:POSTED_IN_CHANNEL]->(d)`,{status,uploader:uploader?'owner':null});}
async function run(repository:PipelineNotificationRepository){return notifyUploaderOfPipelineResult({repository,pipelineId:'pipeline / "',now});}
const normalize=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const namespace=key==='id'&&this.event?.includes('relationship')?'relationship':'node';const identity=namespace+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt'].includes(key)&&value!==null?'<time>':value;}));};
async function state(){
 const rows=(await driver.executeQuery(`MATCH(p:PluginPipelineRun) OPTIONAL MATCH(u:User)-[r:HAS_NOTIFICATION]->(n:Notification) RETURN toString(p.notifiedAt) AS claimed,u.username AS username,n.id AS id,n.text AS text,n.link AS link,n.notificationType AS type,n.read AS read,toString(id(r)) AS relationshipId,toString(id(u)) AS userNodeId,toString(id(n)) AS notificationNodeId`)).records.map(r=>r.toObject());
 for(const row of rows){if(row.id){
  assert.match(row.id,/^[0-9a-f-]{36}$/);
  const created=events.find(e=>e.event==='create'&&e.typename==='Notification'&&e.properties?.new?.id===row.id);
  assert.ok(created,'Notification event must reference persisted UUID');assert.equal(created.id,row.notificationNodeId);
  const relationship=events.find(e=>e.event==='create_relationship'&&e.relationshipName==='HAS_NOTIFICATION');
  assert.ok(relationship);assert.equal(relationship.id,row.relationshipId);assert.equal(relationship.id_from,row.userNodeId);assert.equal(relationship.id_to,row.notificationNodeId);assert.equal(relationship.properties.to.id,row.id);
 }}
 for(const event of events){assert.ok(Number.isFinite(event.timestamp));for(const properties of Object.values(event.properties) as Array<Record<string,unknown>>){if(properties==null)continue;for(const field of ['createdAt','updatedAt'])if(properties[field]!=null)assert.ok(Number.isFinite(Date.parse(String(properties[field]))));}}
 const values=rows.map(({relationshipId:_relationshipId,userNodeId:_userNodeId,notificationNodeId:_notificationNodeId,...row})=>row);
 return normalize({rows:values,events});
}
for(const status of ['SUCCEEDED','FAILED','TIMED_OUT','CANCELLED'])test(`terminal ${status} preserves ordered events, graph, literal links and single claim`,async()=>{await seed(status);assert.equal(await run(legacy()),true);const expected=await state();assert.equal(expected.rows[0].username,'owner');assert.match(expected.rows[0].link,/forum%20%2F%20%22/);assert.equal(expected.rows[0].type,'plugin_pipeline');assert.equal(expected.rows[0].read,false);assert.equal(await run(legacy()),false);assert.deepEqual(await state(),expected);await resetDatabase(driver);await seed(status);events=[];assert.equal(await run(createPipelineNotificationRepository(driver)),true);assert.deepEqual(await state(),expected);assert.equal(await run(createPipelineNotificationRepository(driver)),false);assert.deepEqual(await state(),expected);});
test('canonical author fallback and archived-only channel preserve null link',async()=>{await seed('FAILED',false);await driver.executeQuery('MATCH(c:DiscussionChannel) SET c.archived=true');assert.equal(await run(legacy()),true);const expected=await state();assert.equal(expected.rows[0].link,null);await resetDatabase(driver);await seed('FAILED',false);await driver.executeQuery('MATCH(c:DiscussionChannel) SET c.archived=true');events=[];assert.equal(await run(createPipelineNotificationRepository(driver)),true);assert.deepEqual(await state(),expected);});
test('active and absent attempts do not claim or create; generated variable errors match',async()=>{const old=legacy(),candidate=createPipelineNotificationRepository(driver);for(const repo of [old,candidate]){assert.equal(await run(repo),false);}await seed('RUNNING');for(const repo of [old,candidate])assert.equal(await run(repo),false);assert.equal(events.length,0);await assert.rejects(candidate.findAttempt(123 as any),/ID cannot represent/);});
test('projection failure retains committed claim and notification; retry does not deliver again',async()=>{await schema(true);try{await seed();await assert.rejects(run(legacy()),/notification projection failed/);const expected=await state();assert.ok(expected.rows[0].claimed);assert.equal(expected.rows[0].type,'plugin_pipeline');assert.equal(await run(legacy()),false);await resetDatabase(driver);await seed();events=[];await assert.rejects(run(createPipelineNotificationRepository(driver)),/notification projection failed/);assert.deepEqual(await state(),expected);assert.equal(await run(createPipelineNotificationRepository(driver)),false);}finally{await schema();}});
