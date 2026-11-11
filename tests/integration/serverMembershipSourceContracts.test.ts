import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import {Kind} from 'graphql';
import type {GraphQLSchema} from 'graphql';
import typeDefs from '../../typeDefs.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createServerAdminRepository} from '../../services/persistence/serverAdminRepository.js';
import {createServerModeratorRepository} from '../../services/persistence/serverModeratorRepository.js';
import {createServerInvitationRepository} from '../../services/persistence/serverInvitationRepository.js';
import {serverMembershipSelection} from '../../customResolvers/contracts/serverMembershipSelection.js';
import {serverMembershipConfig} from '../helpers/serverMembershipSource.js';
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
 await driver.executeQuery("CREATE (:ServerConfig {serverName:'cats'}) CREATE (:User {username:'alice',createdAt:datetime('2020-01-01T00:00:00Z')}) CREATE (:ModerationProfile {displayName:'ModAlice'})");
});
after(async()=>stopNeo4j());
const operations=()=>{
 const owner=createServerAdminRepository(driver),mod=createServerModeratorRepository(driver),invite=createServerInvitationRepository(driver);
 return {
  connectAdmin:(name:string)=>owner.connectAdmin(name,'alice'),
  disconnectAdminInvite:(name:string)=>owner.disconnectInvite(name,'alice'),
  connectModerator:(name:string)=>mod.connectModerator(name,'ModAlice'),
  disconnectModeratorInvite:(name:string)=>mod.disconnectInvite(name,'alice'),
  connectAdminInvite:(name:string)=>invite.connectAdminInvite(name,'alice'),
  connectModeratorInvite:(name:string)=>invite.connectModeratorInvite(name,'alice'),
 };
};
for(const name of ['connectAdmin','disconnectAdminInvite','connectModerator','disconnectModeratorInvite','connectAdminInvite','connectModeratorInvite'] as const){
 test(`${name} executes exactly the declared completed membership projection`,async()=>{
  const field=schema.getMutationType()?.getFields().updateServerConfigs;
  assert.ok(field?.resolve);
  const resolve=field.resolve;
  let captured=0;
  field.resolve=(parent,args,context,info)=>{
   const serverConfigs=info.fieldNodes.flatMap(node=>node.selectionSet?.selections??[]).find(node=>node.kind===Kind.FIELD&&node.name.value==='serverConfigs');
   assert.ok(serverConfigs?.kind===Kind.FIELD);
   const selected=serverConfigs.selectionSet?.selections.map(node=>{
    assert.equal(node.kind,Kind.FIELD);
    assert.ok(node.kind===Kind.FIELD);
    assert.equal(node.alias,undefined);
    assert.equal(node.selectionSet,undefined);
    return node.name.value;
   });
   assert.deepEqual(selected?.sort(),Object.keys(serverMembershipSelection).sort());
   captured++;
   return resolve(parent,args,context,info);
  };
  try {
   const result=await operations()[name]('cats');
   assert.equal(result.serverConfigs.length,1);
   assert.deepEqual(JSON.parse(JSON.stringify(result.serverConfigs[0])),serverMembershipConfig());
   assert.deepEqual((await operations()[name]('missing')).serverConfigs,[]);
   assert.equal(captured,2);
  } finally {field.resolve=resolve;}
 });
}

