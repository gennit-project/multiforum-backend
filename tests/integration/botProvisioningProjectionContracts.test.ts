import assert from 'node:assert/strict';
import test from 'node:test';
import neo4j from 'neo4j-driver';
import {buildPublicSchema} from '../../build_scripts/publicSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createBotIdentityRepository} from '../../services/persistence/botIdentityRepository.js';
import {createChannelBotRepository} from '../../services/persistence/channelBotRepository.js';
import {botIdentitySelection,botChannelSelection,channelBotSettingsSelection,serverBotSettingsSelection,botUserWriteSelection,botChannelWriteSelection} from '../../customResolvers/contracts/botProvisioningProjections.js';
import {declaredResponsePaths,staticResponsePaths} from '../helpers/staticResponsePaths.js';
test('bot identity and channel provisioning execute their declared fixed projections',async()=>{
 const driver=neo4j.driver('bolt://127.0.0.1:1',neo4j.auth.basic('projection','unused'));
 try{
  const schema=await buildPublicSchema();const calls:{root:string;paths:string[]}[]=[];
  for(const root of ['users','channels','serverConfigs'])schema.getQueryType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{calls.push({root,paths:staticResponsePaths(info)});return [];};
  for(const [root,field] of [['createUsers','users'],['updateUsers','users'],['updateChannels','channels']])schema.getMutationType()!.getFields()[root].resolve=(_p,_a,_c,info)=>{calls.push({root,paths:staticResponsePaths(info)});return {[field]:[]};};
  registerGeneratedSchema(driver,schema);const identity=createBotIdentityRepository(driver),channel=createChannelBotRepository(driver);
  const cases:[string,Record<string,unknown>,()=>Promise<unknown>][]=[
   ['users',botIdentitySelection,()=>identity.findIdentity('bot')],
   ['channels',botChannelSelection,()=>identity.findChannelBots('forum')],
   ['createUsers',{users:botUserWriteSelection},()=>identity.createIdentity({username:'bot'})],
   ['updateUsers',{users:botUserWriteSelection},()=>identity.reactivateIdentity('bot',{isBot:{set:true}})],
   ['updateChannels',{channels:botChannelWriteSelection},()=>identity.connectBot('forum','bot')],
   ['updateChannels',{channels:botChannelWriteSelection},()=>identity.disconnectBots('forum',['bot'])],
   ['channels',channelBotSettingsSelection,()=>channel.findChannelPlugins('forum')],
   ['serverConfigs',serverBotSettingsSelection,()=>channel.findServerPlugins()],
   ['updateUsers',{users:botUserWriteSelection},()=>channel.deprecateBot('bot','unused')],
   ['updateChannels',{channels:botChannelWriteSelection},()=>channel.disconnectOrphans('forum',['bot'])],
  ];
  for(const [root,selection,invoke] of cases){calls.length=0;await invoke();assert.deepEqual(calls,[{root,paths:declaredResponsePaths(selection)}],`${root}: bot provisioning document drift`);}
 }finally{await driver.close();}
});
