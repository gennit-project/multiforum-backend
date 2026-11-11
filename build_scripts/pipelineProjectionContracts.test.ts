import assert from "node:assert/strict";
import test from "node:test";
import neo4j from "neo4j-driver";
import {buildPublicSchema} from "./publicSchema.js";
import {registerGeneratedSchema} from "../services/persistence/generatedSchemaOperations.js";
import {createPipelineStartRepository} from "../services/persistence/pipelineStartRepository.js";
import {createPipelineRerunRepository} from "../services/persistence/pipelineRerunRepository.js";
import * as selections from "../customResolvers/contracts/pluginExecutionProjections.js";
import {staticResponsePaths,declaredResponsePaths} from "../tests/helpers/staticResponsePaths.js";

test("actual pipeline repository operations match their generated fixed projection declarations",async()=>{
 const schema=await buildPublicSchema();
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 driver.session=()=>{throw Error('Projection guard must not access a database');};
 const calls:{root:string;paths:string[]}[]=[];
 for(const root of ['downloadableFiles','discussions','channels','serverConfigs','pluginPipelineRuns']){
  schema.getQueryType()!.getFields()[root].resolve=(_parent,_args,_context,info)=>{calls.push({root,paths:staticResponsePaths(info)});return [];};
 }
 registerGeneratedSchema(driver,schema);
 const start=createPipelineStartRepository(driver),rerun=createPipelineRerunRepository(driver);
 const cases:[string,Record<string,unknown>,()=>Promise<unknown>][]=[
  ['downloadableFiles',selections.startFileSelection,()=>start.findFileTarget('file')],
  ['discussions',selections.startDiscussionSelection,()=>start.findDiscussionTarget('discussion')],
  ['channels',selections.startChannelSelection,()=>start.findChannelPlan('forum')],
  ['serverConfigs',selections.startServerSelection,()=>start.findServerPlan()],
  ['pluginPipelineRuns',selections.activeAttemptSelection,()=>start.findActiveAttempts({pipelineId:{eq:'attempt'}})],
  ['pluginPipelineRuns',selections.startedAttemptSelection,()=>start.findStartedAttempt('attempt')],
  ['pluginPipelineRuns',selections.rerunSourceSelection,()=>rerun.findSourceAttempt('attempt')],
  ['downloadableFiles',selections.fileVersionSelection,()=>rerun.findFileVersion('file')],
  ['discussions',selections.rerunDiscussionSelection,()=>rerun.findDiscussionVersion('discussion')],
  ['pluginPipelineRuns',selections.rerunRelatedSelection,()=>rerun.findRelatedAttempts({pipelineId:{eq:'attempt'}})],
 ];
 try{
  for(const [root,selection,invoke] of cases){
   calls.length=0;assert.deepEqual(await invoke(),[]);
   assert.deepEqual(calls,[{root,paths:declaredResponsePaths(selection)}],`Executed ${root} selection drifted from its declared projection`);
  }
 }finally{await driver.close();}
});
