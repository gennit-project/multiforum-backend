import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import getResolvers from '../helpers/getTestResolvers.js';
import {readResponseOperations,readSupportList} from '../../build_scripts/frontendCompatibility.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';

const fixtures=readResponseOperations(
 readFileSync('graphql-compatibility/response-operations.json','utf8'),
 readSupportList(readFileSync('graphql-compatibility/supported-frontends.json','utf8')),
);
let driver:Driver,schema:GraphQLSchema;
before(async()=>{
 driver=await startNeo4j();
 schema=applyMiddleware(await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema(),permissions);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 await resetDatabase(driver);
 await driver.executeQuery(`CREATE(c:Channel{uniqueName:'forum',displayName:'Forum',createdAt:datetime()}),
 (empty:Channel{uniqueName:'empty',createdAt:datetime()}),
 (bot:User{username:'bot',displayName:'Bot',createdAt:datetime()}),
 (admin:User{username:'owner',displayName:'Owner',createdAt:datetime()}),
 (moderator:ModerationProfile{displayName:'Moderator',createdAt:datetime()})
 CREATE(c)-[:BOT]->(bot),(admin)-[:ADMIN_OF_CHANNEL]->(c),(c)-[:MODERATOR]->(moderator)
 WITH bot UNWIND [{id:'active',suspendedIndefinitely:true},
 {id:'future',suspendedUntil:datetime('2099-01-01')},
 {id:'expired',suspendedUntil:datetime('2000-01-01')}] AS props
 CREATE(s:Suspension) SET s=props,s.createdAt=datetime()
 CREATE(bot)-[:SUSPENDED_AS_USER]->(s)`);
});
const execute=(source:string,uniqueName='forum')=>graphql({schema,source,
 variableValues:{uniqueName,channelUniqueName:uniqueName,now:'2026-01-01T00:00:00Z'},
 contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false},
});
for(const document of fixtures.documents){
 test(`${document.id}: exact supported client query reads bot suspension counts anonymously`,async()=>{
  const result=await execute(document.source);
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const rows=JSON.parse(JSON.stringify(result.data)).channels;
  assert.equal(rows.length,1);assert.equal(rows[0].uniqueName,'forum');
  assert.equal(rows[0].Bots.length,1);assert.equal(rows[0].Bots[0].username,'bot');
  assert.equal(rows[0].Bots[0].SuspensionsConnection.aggregate.count.nodes,2);
 });
 test(`${document.id}: empty and missing forums preserve list semantics`,async()=>{
  const empty=await execute(document.source,'empty');assert.equal(empty.errors,undefined,JSON.stringify(empty.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(empty.data)).channels[0].Bots,[]);
  const absent=await execute(document.source,'missing');assert.equal(absent.errors,undefined,JSON.stringify(absent.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(absent.data)),{channels:[]});
 });
}

test('client read access does not grant private bot email access',async()=>{
 const result=await execute('{channels(where:{uniqueName:{eq:"forum"}}){Bots{username Email{address}}}}');
 assert.ok(result.errors?.some(error=>JSON.stringify(error.path)===JSON.stringify(['channels',0,'Bots',0,'Email'])));
 const bot=JSON.parse(JSON.stringify(result.data)).channels[0].Bots[0];
 assert.equal(bot.username,'bot');assert.equal(bot.Email,null);
});

test('actual client queries retain nullable child error paths for malformed persisted display names',async()=>{
 await driver.executeQuery("MATCH(bot:User{username:'bot'}) SET bot.displayName=['malformed']");
 for(const document of fixtures.documents){
  const result=await execute(document.source);
  assert.ok(result.errors?.some(error=>JSON.stringify(error.path)===JSON.stringify(['channels',0,'Bots',0,'displayName'])));
  const bot=JSON.parse(JSON.stringify(result.data)).channels[0].Bots[0];
  assert.equal(bot.username,'bot');assert.equal(bot.displayName,null);
  assert.equal(bot.SuspensionsConnection.aggregate.count.nodes,2);
 }
});
