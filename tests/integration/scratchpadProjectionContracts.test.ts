import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {canonicalSelection as canonical,declaredSelection as expected} from '../helpers/exactSelection.js';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createScratchpadRepository} from '../../services/persistence/scratchpadRepository.js';
import {scratchpadRecipientSelection,scratchpadCommentSelection,scratchpadDiscussionSelection,scratchpadOwnershipSelection,scratchpadVisibilitySelection,scratchpadEntrySelection} from '../../customResolvers/contracts/scratchpadProjections.js';

test('all actual scratchpad repository documents match their declared projections including union branches',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema();const calls:{root:string;selection:string}[]=[];
  for(const root of ['users','comments','discussionChannels','scratchpadEntries']){
   schema.getQueryType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{
    assert.equal(info.fieldNodes.length,1);assert.ok(info.fieldNodes[0].selectionSet);
    calls.push({root,selection:canonical(info.fieldNodes[0].selectionSet)});return [];
   };
  }
  for(const root of ['updateScratchpadEntries','deleteScratchpadEntries']){
   schema.getMutationType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{
    assert.equal(info.fieldNodes.length,1);assert.ok(info.fieldNodes[0].selectionSet);
    calls.push({root,selection:canonical(info.fieldNodes[0].selectionSet)});
    return root==='updateScratchpadEntries'?{scratchpadEntries:[]}:{nodesDeleted:0,relationshipsDeleted:0};
   };
  }
  registerGeneratedSchema(driver,schema);const repository=createScratchpadRepository(driver);
  const cases:[string,Record<string,unknown>,()=>Promise<unknown>][]=[
   ['users',scratchpadRecipientSelection,()=>repository.findRecipient('alice')],
   ['comments',scratchpadCommentSelection,()=>repository.findCommentSource('comment')],
   ['discussionChannels',scratchpadDiscussionSelection,()=>repository.findDiscussionSource('post')],
   ['scratchpadEntries',scratchpadOwnershipSelection,()=>repository.findOwnership('entry')],
   ['scratchpadEntries',scratchpadVisibilitySelection,()=>repository.findVisibility('entry')],
   ['updateScratchpadEntries',{scratchpadEntries:scratchpadEntrySelection},()=>repository.updateVisibility('entry',true)],
   ['deleteScratchpadEntries',{nodesDeleted:true,relationshipsDeleted:true},()=>repository.deleteEntry('entry')],
  ];
  for(const [root,selection,invoke] of cases){
   calls.length=0;await invoke();
   assert.deepEqual(calls,[{root,selection:expected(selection)}],`${root}: scratchpad document drift`);
  }
 }finally{await driver.close();}
});
