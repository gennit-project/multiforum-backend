import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createPipelineNotificationRepository} from '../../services/persistence/pipelineNotificationRepository.js';
import {pipelineNotificationAttemptSelection,pipelineNotificationFileSelection,notificationDeliveryUserSelection} from '../../customResolvers/contracts/pipelineNotificationProjections.js';
import {createEmailNotificationRepository} from '../../services/persistence/emailNotificationRepository.js';
import {createNotificationWriter} from '../../services/persistence/notificationWriter.js';
import {notificationSubscriberSelection} from '../../customResolvers/contracts/notificationProjections.js';
import {canonicalSelection,declaredSelection} from '../helpers/exactSelection.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
test('six delivery documents preserve recipient projections and post-commit default selections',async()=>{
 const driver=await startNeo4j();
 try{
  await resetDatabase(driver);
  const schema=await buildPublicSchema(),calls:{root:string;selection:string}[]=[];
  for(const root of ['pluginPipelineRuns','downloadableFiles','users'])schema.getQueryType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);calls.push({root,selection:canonicalSelection(selection)});return [];};
  schema.getMutationType()!.getFields().updateUsers.resolve=(_p,_a,_c,info)=>{const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);calls.push({root:'updateUsers',selection:canonicalSelection(selection)});return {users:[]};};
  registerGeneratedSchema(driver,schema);const repository=createPipelineNotificationRepository(driver);
  assert.deepEqual(await repository.findAttempt('pipeline'),[]);
  assert.deepEqual(await repository.findTargetFile('file'),[]);
  await driver.executeQuery("CREATE(:User{username:'owner'}),(:DownloadableFile{id:'file'}),(:PluginPipelineRun{pipelineId:'pipeline',targetId:'file',targetType:'DownloadableFile',status:'SUCCEEDED'})");
  assert.equal(await repository.deliver({pipelineId:'pipeline',targetId:'file',username:'owner',timestamp:'2026-07-30T12:00:00Z',text:'result',link:null}),true);
  const email=createEmailNotificationRepository(driver);
  assert.deepEqual(await email.findRecipient('owner'),[]);
  assert.equal(await email.createAfterEmailNotification('owner','text'),false);
  assert.equal(await createNotificationWriter(driver).createForUser({username:'owner',text:'text',notificationType:'reply'}),false);
  assert.deepEqual(calls,[
   {root:'pluginPipelineRuns',selection:declaredSelection(pipelineNotificationAttemptSelection)},
   {root:'downloadableFiles',selection:declaredSelection(pipelineNotificationFileSelection)},
   {root:'users',selection:declaredSelection(notificationDeliveryUserSelection)},
   {root:'users',selection:declaredSelection(notificationSubscriberSelection)},
   {root:'updateUsers',selection:declaredSelection({users:notificationDeliveryUserSelection})},
   {root:'updateUsers',selection:declaredSelection({users:notificationDeliveryUserSelection})},
  ]);
  assert.equal((await driver.executeQuery('MATCH(n:Notification) RETURN count(n) AS count')).records[0].get('count').toNumber(),1);
 }finally{await stopNeo4j();}
});
