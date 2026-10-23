import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineNotificationRepository,type PipelineNotificationRepository} from '../../services/persistence/pipelineNotificationRepository.js';
import {notifyUploaderOfPipelineResult} from '../../services/plugin/pipelineNotifications.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
async function schema(fail=false){const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:fail?{...app.resolvers,User:{displayName:()=>{throw Error('notification projection failed');}}}:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const executable=await neo.getSchema();registerGeneratedSchema(driver,executable);}
before(async()=>{driver=await startNeo4j();await schema();},{timeout:240000});beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
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
for(const status of ['SUCCEEDED','FAILED','TIMED_OUT','CANCELLED'])test(`terminal ${status} preserves ordered events, graph, literal links and single claim`,async(t)=>{await seed(status);const repo=createPipelineNotificationRepository(driver);assert.equal(await run(repo),true);const snapshot=await state();assert.equal(snapshot.rows[0].username,'owner');assert.match(snapshot.rows[0].link,/forum%20%2F%20%22/);assert.equal(snapshot.rows[0].type,'plugin_pipeline');assert.equal(snapshot.rows[0].read,false);assert.equal(await run(repo),false);assert.deepEqual(await state(),snapshot);t.assert.snapshot(snapshot);});
test('canonical author fallback and archived-only channel preserve null link',async(t)=>{await seed('FAILED',false);await driver.executeQuery('MATCH(c:DiscussionChannel) SET c.archived=true');const repo=createPipelineNotificationRepository(driver);assert.equal(await run(repo),true);const snapshot=await state();assert.equal(snapshot.rows[0].link,null);t.assert.snapshot(snapshot);});
test('active and absent attempts do not claim or create; generated variable errors match',async()=>{const candidate=createPipelineNotificationRepository(driver);for(const repo of [candidate]){assert.equal(await run(repo),false);}await seed('RUNNING');for(const repo of [candidate])assert.equal(await run(repo),false);assert.equal(events.length,0);await assert.rejects(candidate.findAttempt(123 as any),/String cannot represent a non string value/);});
test('projection failure retains committed claim and notification; retry does not deliver again',async(t)=>{await schema(true);try{await seed();const repo=createPipelineNotificationRepository(driver);await assert.rejects(run(repo),/notification projection failed/);const snapshot=await state();assert.ok(snapshot.rows[0].claimed);assert.equal(snapshot.rows[0].type,'plugin_pipeline');assert.equal(await run(repo),false);assert.deepEqual(await state(),snapshot);t.assert.snapshot(snapshot);}finally{await schema();}});
