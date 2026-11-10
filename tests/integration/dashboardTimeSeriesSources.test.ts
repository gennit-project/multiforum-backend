import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();schema=applyMiddleware(await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema(),sourceIdentity);},{timeout:240000});
after(async()=>stopNeo4j());beforeEach(async()=>resetDatabase(driver));
const run=(fields:string)=>graphql({schema,source:`{getServerHealthDashboard(startDate:"2026-01-01",endDate:"2026-01-01"){timeSeries{${fields}}}}`,contextValue:{driver}});
test('dashboard time-series fields retain meaning under colliding aliases',async()=>{
 await driver.executeQuery("CREATE(ch:Channel {uniqueName:'forum'}),(dc:DiscussionChannel {id:'dc',createdAt:datetime('2026-01-01')})-[:POSTED_IN_CHANNEL]->(ch),(dc)-[:POSTED_IN_CHANNEL]->(:Discussion {id:'d',createdAt:datetime('2026-01-01'),deleted:false})");
 const result=await run('discussions comments:discussions');assert.equal(result.errors,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{getServerHealthDashboard:{timeSeries:[{discussions:1,comments:1}]}});
});
test('executed time-series query returns every computed field',async()=>{
 const {timeSeriesQuery}=await import('../../customResolvers/queries/getServerHealthDashboard.js');
 const {dashboardTimeSeriesSelection}=await import('../../customResolvers/contracts/pluginSummaryMetadata.js');
 const rows=await driver.executeQuery(timeSeriesQuery,{startDate:'2026-01-01',endDate:'2026-01-03',channelUniqueNames:[]});
 const series=rows.records[0].get('timeSeries');assert.equal(series.length,3);
 for(const row of series){assert.deepEqual(Object.keys(row).sort(),Object.keys(dashboardTimeSeriesSelection).sort());assert.match(row.date,/^2026-01-0[123]$/);}
});
test('all zero counters serialize with consecutive computed dates',async()=>{
 const result=await run('date discussions comments events downloads issuesOpened moderationActions');assert.equal(result.errors,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{getServerHealthDashboard:{timeSeries:[{date:'2026-01-01',discussions:0,comments:0,events:0,downloads:0,issuesOpened:0,moderationActions:0}]}});
});
test('time-series aliases and fragment directives retain their requested fields',async()=>{
 const source='query($include:Boolean!){getServerHealthDashboard(startDate:"2026-01-01",endDate:"2026-01-01"){timeSeries{...Fields}}} fragment Fields on ServerHealthTimeSeriesPoint{comments:date discussions:events @include(if:$include)}';
 for(const include of [false,true]){
 const result=await graphql({schema,source,variableValues:{include},contextValue:{driver}});assert.equal(result.errors,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{getServerHealthDashboard:{timeSeries:[{comments:'2026-01-01',...(include?{discussions:0}:{})}]}});
 }
});
test('dashboard permission middleware still denies anonymous reads',async()=>{
 const {default:permissions}=await import('../../permissions.js');
 const result=await graphql({schema:applyMiddleware(schema,permissions),source:'{getServerHealthDashboard{timeSeries{date}}}',contextValue:{driver,req:{headers:{}}}});
 assert.ok(result.errors?.length);assert.equal(result.data,null);
});
