import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createBotReportRepository} from '../../services/persistence/botReportRepository.js';
import {botExistingReportSelection,botReportedCommentSelection,botReportedDiscussionSelection,botReportedEventSelection} from '../../customResolvers/contracts/botReportProjections.js';
import {canonicalSelection,declaredSelection} from '../helpers/exactSelection.js';
test('all bot-report reads match their declared selections including explicit author union branches',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema(), calls:{root:string;selection:string}[]=[];
  for(const root of ['issues','comments','discussions','events'])schema.getQueryType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{
   assert.equal(info.fieldNodes.length,1);const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);
   calls.push({root,selection:canonicalSelection(selection)});return [];
  };
  registerGeneratedSchema(driver,schema);const repository=createBotReportRepository(driver);
  const cases:[string,Record<string,unknown>,()=>Promise<unknown>][]=[
   ['issues',botExistingReportSelection,()=>repository.findExistingReport({channelUniqueName:{eq:'forum'}})],
   ['issues',botExistingReportSelection,()=>repository.findIdempotentReport({channelUniqueName:{eq:'forum'}},'key')],
   ['comments',botReportedCommentSelection,()=>repository.findReportedComment('comment')],
   ['discussions',botReportedDiscussionSelection,()=>repository.findReportedDiscussion('discussion')],
   ['events',botReportedEventSelection,()=>repository.findReportedEvent('event')],
  ];
  for(const [root,selection,invoke] of cases){calls.length=0;assert.deepEqual(await invoke(),[]);assert.deepEqual(calls,[{root,selection:declaredSelection(selection)}],`${root}: bot report document drift`);}
 }finally{await driver.close();}
});
