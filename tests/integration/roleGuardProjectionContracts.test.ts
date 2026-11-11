import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createRoleGuardRepository} from '../../services/persistence/roleGuardRepository.js';
import {roleChannelAdminsSelection,channelRoleOwnerSelection,serverRoleCapabilitiesSelection,modServerRoleCapabilitiesSelection} from '../../customResolvers/contracts/roleGuardProjections.js';
import {canonicalSelection,declaredSelection} from '../helpers/exactSelection.js';
test('role guard documents retain every selected owner and capability field',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema(),calls:{root:string;selection:string}[]=[];
  for(const root of ['channels','channelRoles','modChannelRoles','serverRoles','modServerRoles'])schema.getQueryType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{
    const selection=info.fieldNodes[0].selectionSet;assert.ok(selection);calls.push({root,selection:canonicalSelection(selection)});return [];
  };
  registerGeneratedSchema(driver,schema);const repository=createRoleGuardRepository(driver);
  const cases:[string,Record<string,unknown>,()=>Promise<unknown>][]=[
    ['channels',roleChannelAdminsSelection,()=>repository.findChannelAdmins('forum')],
    ['channelRoles',channelRoleOwnerSelection,()=>repository.findChannelRoleOwners({})],
    ['modChannelRoles',channelRoleOwnerSelection,()=>repository.findModChannelRoleOwners({})],
    ['serverRoles',serverRoleCapabilitiesSelection,()=>repository.findServerRoleCapabilities({})],
    ['modServerRoles',modServerRoleCapabilitiesSelection,()=>repository.findModServerRoleCapabilities({})],
  ];
  for(const [root,selection,invoke] of cases){calls.length=0;assert.deepEqual(await invoke(),[]);assert.deepEqual(calls,[{root,selection:declaredSelection(selection)}],`${root}: role permission document drift`);}
 }finally{await driver.close();}
});
