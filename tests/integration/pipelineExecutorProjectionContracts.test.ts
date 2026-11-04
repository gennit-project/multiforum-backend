import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {parse, type SelectionSetNode} from 'graphql';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createChannelExecutionRepository} from '../../services/persistence/channelExecutionRepository.js';
import {createCommentExecutionRepository} from '../../services/persistence/commentExecutionRepository.js';
import * as projections from '../../customResolvers/contracts/pipelineExecutorProjections.js';
import {canonicalSelection,declaredSelection} from '../helpers/exactSelection.js';

function withArguments(selection:Record<string,unknown>, replacements:[string,string][]=[]):string {
 let source=declaredSelection(selection);
 for(const [field,args] of replacements)source=source.replace(`${field} {`,`${field}(${args}) {`);
 const operation=parse(`query ${source}`).definitions[0];
 assert.equal(operation.kind,'OperationDefinition');
 if(operation.kind!=='OperationDefinition')assert.fail('Expected operation');
 return canonicalSelection(operation.selectionSet);
}

test('all fifteen executor documents retain precise projections, author branches, ordering and attachment limit',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema();
  const calls:{root:string;selection:string}[]=[];
  const capture=(root:string,selection:SelectionSetNode|undefined)=>{assert.ok(selection);calls.push({root,selection:canonicalSelection(selection)});};
  for(const root of ['channels','discussions','comments','serverConfigs','pluginRuns','serverSecrets'])schema.getQueryType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{capture(root,info.fieldNodes[0].selectionSet);return [];};
  for(const [root,field] of [['createPluginRuns','pluginRuns'],['updatePluginRuns','pluginRuns'],['updateDownloadableFiles','downloadableFiles']])schema.getMutationType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{capture(root,info.fieldNodes[0].selectionSet);return {[field]:[]};};
  registerGeneratedSchema(driver,schema);
  const channel=createChannelExecutionRepository(driver),comment=createCommentExecutionRepository(driver);
  const cases:[string,string,()=>Promise<unknown>][]=[
   ['channels',withArguments(projections.channelExecutionChannelSelection,[['FilterGroups','sort: [{order: ASC}]'],['options','sort: [{order: ASC}]']]),()=>channel.findChannel('forum')],
   ['channels',declaredSelection(projections.commentExecutionChannelSelection),()=>comment.findChannel('forum')],
   ['discussions',withArguments(projections.channelExecutionDiscussionSelection,[['DownloadableFiles','limit: 1']]),()=>channel.findDiscussion('discussion')],
   ['comments',declaredSelection(projections.commentExecutionCommentSelection),()=>comment.findComment('comment')],
   ['updateDownloadableFiles',declaredSelection({downloadableFiles:projections.executionFileWriteSelection}),()=>channel.writeScanState('file',{})],
  ];
  for(const repository of [channel,comment])cases.push(
   ['serverConfigs',declaredSelection(projections.executionConfigurationSelection),()=>repository.findConfiguration()],
   ['createPluginRuns',declaredSelection({pluginRuns:projections.executionPendingRunSelection}),()=>repository.createPendingRuns([])],
   ['updatePluginRuns',declaredSelection({pluginRuns:projections.executionPendingRunSelection}),()=>repository.markSkippedRun('run',{})],
   ['pluginRuns',declaredSelection(projections.executionReturnedRunSelection),()=>repository.findReturnedRun('run')],
   ['serverSecrets',declaredSelection(projections.executionSecretSelection),()=>repository.findSecrets('plugin')],
  );
  for(const [root,selection,invoke] of cases){calls.length=0;await invoke();assert.deepEqual(calls,[{root,selection}],`${root}: executor document drift`);}
  assert.equal(cases.length,15);
 }finally{await driver.close();}
});
