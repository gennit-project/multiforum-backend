import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import type {Driver} from 'neo4j-driver';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createDiscussionCreationRepository} from '../../services/persistence/discussionCreationRepository.js';
import {createEventWriteRepository} from '../../services/persistence/eventWriteRepository.js';
import {attachedDiscussionFilesSelection,createdDiscussionSelection,createdEventSelection} from '../../customResolvers/contracts/contentProjections.js';
import {declaredResponsePaths,staticResponsePaths} from '../helpers/staticResponsePaths.js';
import {startNeo4j,stopNeo4j} from './neo4jHarness.js';

let driver:Driver;
before(async()=>{driver=await startNeo4j();},{timeout:240000});
after(async()=>stopNeo4j());

test('actual discussion and event creation/read documents match their declared projections',async()=>{
 const schema=await buildPublicSchema();
 const calls:{root:string;paths:string[]}[]=[];
 for(const root of ['discussions','events']){
  schema.getQueryType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{
   calls.push({root,paths:staticResponsePaths(info)});return [];
  };
 }
 for(const [root,field] of [['createDiscussions','discussions'],['createEvents','events']]){
  schema.getMutationType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{
   calls.push({root,paths:staticResponsePaths(info)});return {[field]:[]};
  };
 }
 registerGeneratedSchema(driver,schema);
 const discussion=createDiscussionCreationRepository(driver),event=createEventWriteRepository(driver);
 const session=driver.session();
 try{
  // A real managed transaction preserves the repositories' execution interface.
  // Root data sources return empty containers: this checks documents, not rows.
  await session.executeWrite(async tx=>{
   const cases:[string,Record<string,unknown>,()=>Promise<unknown>][]=[
    ['createDiscussions',{discussions:createdDiscussionSelection},()=>discussion.createDiscussion({title:'Projection'},tx)],
    ['discussions',createdDiscussionSelection,()=>discussion.findCreatedDiscussion('discussion',tx)],
    ['discussions',attachedDiscussionFilesSelection,()=>discussion.findAttachedFiles('discussion',tx)],
    ['createEvents',{events:createdEventSelection},()=>event.createWithinTransaction({title:'Projection',startTime:'2030-01-01T00:00:00Z',endTime:'2030-01-01T01:00:00Z',canceled:false},tx)],
    ['events',createdEventSelection,()=>event.findCreatedEvent('event',tx)],
   ];
   for(const [root,selection,invoke] of cases){
    calls.length=0;await invoke();
    assert.deepEqual(calls,[{root,paths:declaredResponsePaths(selection)}],`${root}: executed selection drifted from its declared result`);
   }
  });
 }finally{await session.close();}
});
