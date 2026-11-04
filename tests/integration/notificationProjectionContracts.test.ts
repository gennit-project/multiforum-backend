import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createNotificationSnapshotRepository} from '../../services/persistence/notificationSnapshotRepository.js';
import * as projections from '../../customResolvers/contracts/notificationProjections.js';
import {canonicalSelection,declaredSelection} from '../helpers/exactSelection.js';
test('ten notification reads preserve exact preference, recipient and nested author selections',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema(),calls:{root:string;selection:string}[]=[];
  for(const root of ['users','comments','discussions','discussionChannels','events','issues'])schema.getQueryType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);calls.push({root,selection:canonicalSelection(selection)});return [];};
  registerGeneratedSchema(driver,schema);const repository=createNotificationSnapshotRepository(driver);
  const cases:[string,Record<string,unknown>,()=>Promise<unknown>][]=[
   ['users',projections.notificationArchivedAuthorSelection,()=>repository.findArchivedAuthor('author')],
   ['users',projections.notificationFeedbackRecipientSelection,()=>repository.findFeedbackRecipient('author')],
   ['users',projections.notificationMentionRecipientSelection,()=>repository.findMentionRecipients(['author'])],
   ['comments',projections.notificationMentionSelection,()=>repository.findCommentMentionSnapshot('comment')],
   ['discussions',projections.notificationDiscussionSelection,()=>repository.findDiscussionMentionSnapshot('discussion')],
   ['comments',projections.notificationCommentSelection,()=>repository.findCommentNotificationSnapshot('comment')],
   ['discussionChannels',projections.notificationEntitySubscribersSelection,()=>repository.findEntitySubscribers('DiscussionChannel','target')],
   ['events',projections.notificationEntitySubscribersSelection,()=>repository.findEntitySubscribers('Event','target')],
   ['comments',projections.notificationEntitySubscribersSelection,()=>repository.findEntitySubscribers('Comment','target')],
   ['issues',projections.notificationIssueSubscribersSelection,()=>repository.findIssueSubscribers('issue')],
  ];
  for(const [root,selection,invoke] of cases){calls.length=0;assert.deepEqual(await invoke(),[]);assert.deepEqual(calls,[{root,selection:declaredSelection(selection)}],`${root}: notification document drift`);}
  assert.equal(cases.length,10);
 }finally{await driver.close();}
});
