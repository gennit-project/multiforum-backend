import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createCollectionReadRepository} from '../../services/persistence/collectionReadRepository.js';
import {profileCollectionSelection,publicCollectionSelection,collectionShareSelection,collectionShareChannelSelection} from '../../customResolvers/contracts/accountProjections.js';
import {declaredResponsePaths,staticResponsePaths} from '../helpers/staticResponsePaths.js';
import {SortDirection} from '../../src/generated/graphql.js';

test('all five executed collection read documents match their declared selections and retain caller arguments',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema();
  const calls:{root:string;paths:string[];args:unknown;jwt:unknown}[]=[];
  for(const root of ['collections','channels']){
   schema.getQueryType()!.getFields()[root].resolve=(_p,args,context,info)=>{
    calls.push({root,paths:staticResponsePaths(info),args,jwt:context.jwt});return [];
   };
  }
  registerGeneratedSchema(driver,schema);const repository=createCollectionReadRepository(driver);
  const where={name:{eq:'example'}};
  const options={sort:[{name:SortDirection.Asc}],limit:2,offset:3};
  const cases:{root:string;selection:Record<string,unknown>;args:unknown;jwt?:unknown;invoke:()=>Promise<unknown>}[]=[
   {root:'collections',selection:profileCollectionSelection,args:{where,...options},jwt:{sub:'alice'},invoke:()=>repository.findProfileCollections(where,options,'alice')},
   ...[false,true].map(allowed=>({root:'collections',selection:publicCollectionSelection,args:{where,sort:[{createdAt:SortDirection.Desc}]},jwt:{mayAccessSensitiveContent:allowed},invoke:()=>repository.findPublicContaining(where,allowed)})),
   {root:'collections',selection:collectionShareSelection,jwt:{sub:'alice'},args:{where:{id:{eq:'collection'},CreatedBy:{username:{eq:'alice'}}}},invoke:()=>repository.findOwnedShareTarget('collection','alice')},
   {root:'channels',selection:collectionShareChannelSelection,args:{where:{uniqueName:{eq:'forum'}}},invoke:()=>repository.findShareChannel('forum')},
  ];
  for(const {root,selection,args,jwt,invoke} of cases){
   calls.length=0;assert.deepEqual(await invoke(),[]);
   // GraphQL input objects use null prototypes; compare JSON without losing array order.
   assert.deepEqual(JSON.parse(JSON.stringify(calls)),JSON.parse(JSON.stringify([{root,paths:declaredResponsePaths(selection),args,jwt}])),`${root}: collection document drift`);
  }
 }finally{await driver.close();}
});
