import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import {Kind} from 'graphql';
import type {GraphQLSchema} from 'graphql';
import typeDefs from '../../typeDefs.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createForumOwnerRepository} from '../../services/persistence/forumOwnerRepository.js';
import {createForumModeratorRepository} from '../../services/persistence/forumModeratorRepository.js';
import {createForumInvitationRepository} from '../../services/persistence/forumInvitationRepository.js';
import {forumMembershipSelection} from '../../customResolvers/contracts/forumMembershipSelection.js';
import {forumMembershipChannel} from '../helpers/forumMembershipSource.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;
let schema:GraphQLSchema;
before(async()=>{
 driver=await startNeo4j();
 schema=await new Neo4jGraphQL({typeDefs,driver,resolvers:getCustomResolvers(driver).resolvers}).getSchema();
 registerGeneratedSchema(driver,schema);
},{timeout:240_000});
beforeEach(async()=>{
 await resetDatabase(driver);
 await driver.executeQuery("CREATE (:Channel {uniqueName:'cats',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:User {username:'alice',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:ModerationProfile {displayName:'ModAlice'})");
});
after(async()=>stopNeo4j());
const operations=()=>{
 const owner=createForumOwnerRepository(driver),mod=createForumModeratorRepository(driver),invite=createForumInvitationRepository(driver);
 return {
  connectOwner:(name:string)=>owner.connectOwner(name,'alice'),
  disconnectOwner:(name:string)=>owner.disconnectOwner(name,'alice'),
  disconnectOwnerInvite:(name:string)=>owner.disconnectInvite(name,'alice'),
  connectModerator:(name:string)=>mod.connectModerator(name,'ModAlice'),
  disconnectModerator:(name:string)=>mod.disconnectModerator(name,'ModAlice'),
  disconnectModeratorInvite:(name:string)=>mod.disconnectInvite(name,'alice'),
  connectOwnerInvite:(name:string)=>invite.connectOwnerInvite(name,'alice'),
  connectModeratorInvite:(name:string)=>invite.connectModeratorInvite(name,'alice'),
 };
};
for(const name of ['connectOwner','disconnectOwner','disconnectOwnerInvite','connectModerator','disconnectModerator','disconnectModeratorInvite','connectOwnerInvite','connectModeratorInvite'] as const){
 test(`${name} executes exactly the declared completed membership projection`,async()=>{
  const field=schema.getMutationType()?.getFields().updateChannels;
  assert.ok(field?.resolve);
  const resolve=field.resolve;
  let captured=0;
  field.resolve=(parent,args,context,info)=>{
   const channels=info.fieldNodes.flatMap(node=>node.selectionSet?.selections??[]).find(node=>node.kind===Kind.FIELD&&node.name.value==='channels');
   assert.ok(channels?.kind===Kind.FIELD);
   const selected=channels.selectionSet?.selections.map(node=>{
    assert.equal(node.kind,Kind.FIELD);
    assert.ok(node.kind===Kind.FIELD);
    assert.equal(node.alias,undefined);
    assert.equal(node.selectionSet,undefined);
    return node.name.value;
   });
   assert.deepEqual(selected?.sort(),Object.keys(forumMembershipSelection).sort());
   captured++;
   return resolve(parent,args,context,info);
  };
  try {
   const result=await operations()[name]('cats');
   assert.equal(result.channels.length,1);
   assert.deepEqual(JSON.parse(JSON.stringify(result.channels[0])),forumMembershipChannel());
   assert.deepEqual((await operations()[name]('missing')).channels,[]);
   assert.equal(captured,2);
  } finally {field.resolve=resolve;}
 });
}

test('fixed completed fields retain populated scalar values',async()=>{
 await driver.executeQuery("MATCH (c:Channel) SET c.displayName='Cats',c.locked=true,c.allowedFileTypes=['png','jpg'],c.payoutPercent=25,c.lockedAt=datetime('2021-01-01T00:00:00Z')");
 const {channels}=await operations().connectOwner('cats');
 assert.deepEqual(JSON.parse(JSON.stringify(channels[0])),{
  ...forumMembershipChannel(),displayName:'Cats',locked:true,allowedFileTypes:['png','jpg'],payoutPercent:25,lockedAt:'2021-01-01T00:00:00.000Z',
 });
});
