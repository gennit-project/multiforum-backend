import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createContentValidationRepository} from '../../services/persistence/contentValidationRepository.js';
import {validationDiscussionChannelsSelection,validationExistingFilesSelection,discussionChannelEmojiSelection,commentEmojiSelection} from '../../customResolvers/contracts/contentValidationProjections.js';
import {canonicalSelection,declaredSelection} from '../helpers/exactSelection.js';
test('content validation reads retain every permission and preference field in their declared projections',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema(),calls:{root:string;selection:string}[]=[];
  for(const root of ['discussions','downloadableFiles','discussionChannels','comments'])schema.getQueryType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);calls.push({root,selection:canonicalSelection(selection)});return [];};
  registerGeneratedSchema(driver,schema);const repository=createContentValidationRepository(driver);
  const cases:[string,Record<string,unknown>,()=>Promise<unknown>][]=[
   ['discussions',validationDiscussionChannelsSelection,()=>repository.findDiscussionChannels({id:{eq:'discussion'}})],
   ['downloadableFiles',validationExistingFilesSelection,()=>repository.findExistingDownloadableFiles({id:{eq:'file'}})],
   ['discussionChannels',discussionChannelEmojiSelection,()=>repository.findDiscussionChannelEmojiState('discussion-channel')],
   ['comments',commentEmojiSelection,()=>repository.findCommentEmojiState('comment')],
  ];
  for(const [root,selection,invoke] of cases){calls.length=0;assert.deepEqual(await invoke(),[]);assert.deepEqual(calls,[{root,selection:declaredSelection(selection)}],`${root}: validation document drift`);}
 }finally{await driver.close();}
});
