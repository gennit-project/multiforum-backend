import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createEventSeriesDeletionRepository} from '../../services/persistence/eventSeriesDeletionRepository.js';
import {eventSeriesDeletionSelection} from '../../customResolvers/contracts/eventSeriesDeletionProjection.js';
import {canonicalSelection,declaredSelection} from '../helpers/exactSelection.js';
test('series deletion uses only its exact snapshot and native deletion count selections',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema(),calls:{root:string;selection:string}[]=[];
  schema.getQueryType()!.getFields().events.resolve=(_p,_a,_c,info)=>{const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);calls.push({root:'events',selection:canonicalSelection(selection)});return [];};
  for(const root of ['deleteEvents','deleteEventSeries'])schema.getMutationType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);calls.push({root,selection:canonicalSelection(selection)});return {nodesDeleted:0,relationshipsDeleted:0};};
  registerGeneratedSchema(driver,schema);const repository=createEventSeriesDeletionRepository(driver);
  assert.deepEqual(await repository.findSnapshot('event'),[]);
  await repository.deleteOccurrence('event');await repository.deleteTemplate('series');
  assert.deepEqual(calls,[{root:'events',selection:declaredSelection(eventSeriesDeletionSelection)},...['deleteEvents','deleteEventSeries'].map(root=>({root,selection:declaredSelection({nodesDeleted:true,relationshipsDeleted:true})}))]);
 }finally{await driver.close();}
});
