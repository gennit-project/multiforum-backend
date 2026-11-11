import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import middleware from '../../middleware/userChildIdentityMiddleware.js';
import permissions from '../../permissions.js';
import sortedChannels from '../../customResolvers/queries/getSortedChannels.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();schema=applyMiddleware(raw,middleware,permissions);},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);await driver.executeQuery(`CREATE(c:Channel{uniqueName:'forum',displayName:'Forum',description:'About',channelIconURL:'icon'}),(t:Tag{text:'topic'}),(c)-[:HAS_TAG]->(t)`);});
const run=(source:string,variableValues?:Record<string,unknown>)=>graphql({schema,source,variableValues,contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false}});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));

test('sorted channel scalar aliases retain their canonical source fields',async()=>{
 const result=await run('{getSortedChannels(countDownloads:false){channels{uniqueName:displayName displayName:uniqueName}}}');
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getSortedChannels:{channels:[{uniqueName:'Forum',displayName:'forum'}]}});
});
test('sorted tags retain their list when their alias collides with a scalar key',async()=>{
 const result=await run('query($skip:Boolean!){getSortedChannels(countDownloads:false){channels{...Tags description @skip(if:$skip)}}} fragment Tags on Channel {displayName:Tags{text}}',{skip:true});
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getSortedChannels:{channels:[{displayName:[{text:'topic'}]}]}});
});
test('sorted connection count aliases retain canonical nested keys',async()=>{
 await driver.executeQuery(`MATCH(c:Channel) CREATE(d:Discussion{id:'d',hasDownload:false}),(dc:DiscussionChannel{id:'dc',archived:false}),
 (e:Event{id:'e',canceled:false,endTime:datetime()+duration({days:7})}),(ec:EventChannel{id:'ec'}),
 (dc)-[:POSTED_IN_CHANNEL]->(c),(dc)-[:POSTED_IN_CHANNEL]->(d),(ec)-[:POSTED_IN_CHANNEL]->(c),(ec)-[:POSTED_IN_CHANNEL]->(e)`);
 const result=await run('{getSortedChannels(countDownloads:false){channels{events:EventChannelsConnection{n:totalCount a:aggregate{c:count{n:nodes}}} discussions:DiscussionChannelsConnection{n:totalCount a:aggregate{c:count{n:nodes}}}}}}');
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getSortedChannels:{channels:[{events:{n:1,a:{c:{n:1}}},discussions:{n:1,a:{c:{n:1}}}}]}});
});
test('sorted stored scalar failures remain lazy and located at the requested alias',async()=>{
 await driver.executeQuery("MATCH(c:Channel) SET c.displayName=['invalid']");
 const source='query($show:Boolean!){getSortedChannels(countDownloads:false){channels{uniqueName bad:displayName @include(if:$show)}}}';
 assert.equal((await run(source,{show:false})).errors,undefined);
 const result=await run(source,{show:true});
 assert.equal(result.errors?.length,1);
 assert.deepEqual(result.errors?.[0].path,['getSortedChannels','channels',0,'bad']);
});
test('sorted actual query maps retain the exact fixed projection',async()=>{
 const result=await sortedChannels({driver})(null,{countDownloads:false});
 assert.equal(result.channels.length,1);
 const channel=result.channels[0];
 assert.deepEqual(Object.keys(channel).sort(),['uniqueName','displayName','channelIconURL','description','isFavorited','Tags','EventChannelsAggregate','EventChannelsConnection','DiscussionChannelsAggregate','DiscussionChannelsConnection'].sort());
 assert.deepEqual(Object.keys(channel.Tags[0]),['text']);
 for(const count of [channel.EventChannelsAggregate,channel.DiscussionChannelsAggregate]){
  assert.deepEqual(Object.keys(count),['count']);assert.equal(count.count.toNumber(),0);
 }
 for(const connection of [channel.EventChannelsConnection,channel.DiscussionChannelsConnection]){
  assert.deepEqual(Object.keys(connection).sort(),['aggregate','totalCount']);
  assert.deepEqual(Object.keys(connection.aggregate),['count']);
  assert.deepEqual(Object.keys(connection.aggregate.count),['nodes']);
  assert.equal(connection.totalCount.toNumber(),0);assert.equal(connection.aggregate.count.nodes.toNumber(),0);
 }
});
