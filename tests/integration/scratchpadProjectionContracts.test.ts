import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {parse,print,visit,type SelectionSetNode} from 'graphql';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createScratchpadRepository} from '../../services/persistence/scratchpadRepository.js';
import {scratchpadRecipientSelection,scratchpadCommentSelection,scratchpadDiscussionSelection,scratchpadOwnershipSelection,scratchpadVisibilitySelection,scratchpadEntrySelection} from '../../customResolvers/contracts/scratchpadProjections.js';

// Compare exact fixed selections, retaining explicit inline-union branches.
// This does not flatten a conditional union selection into guaranteed fields.
function render(selection:Record<string,unknown>):string {
 return `{${Object.entries(selection).map(([name,value])=>value===true?name:
  value&&typeof value==='object'&&!Array.isArray(value)?`${name}${render(Object.fromEntries(Object.entries(value)))}`:
  assert.fail(`Invalid declared selection at ${name}`)).join(' ')}}`;
}
const canonical=(selection:SelectionSetNode)=>print(visit(selection,{SelectionSet(node){
 return {...node,selections:[...node.selections].sort((left,right)=>print(left).localeCompare(print(right)))};
}}));
function expected(selection:Record<string,unknown>):string {
 const document=parse(`query ${render(selection)}`);
 const operation=document.definitions[0];assert.equal(operation.kind,'OperationDefinition');
 if(operation.kind!=='OperationDefinition')assert.fail('Expected operation');
 return canonical(operation.selectionSet);
}
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
