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
after(async()=>stopNeo4j());beforeEach(async()=>{await resetDatabase(driver);await driver.executeQuery("CREATE(:Channel {uniqueName:'forum',displayName:'Forum'})");});
const run=(fields:string)=>graphql({schema,source:`{getServerHealthDashboard(startDate:"2026-01-01",endDate:"2026-01-01"){channelHealth{${fields}}}}`,contextValue:{driver}});
test('channel-health aliases retain the canonical selected field',async()=>{
 const result=await run('id displayName:id');assert.equal(result.errors,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{getServerHealthDashboard:{channelHealth:[{id:'forum',displayName:'forum'}]}});
});
test('channel query returns fixed native leaves and computed metrics',async()=>{
 const {channelHealthQuery}=await import('../../customResolvers/queries/getServerHealthDashboard.js');
 const {dashboardChannelHealthSelection}=await import('../../customResolvers/contracts/pluginSummaryMetadata.js');
 const rows=await driver.executeQuery(channelHealthQuery,{startDate:'2026-01-01',endDate:'2026-01-01',channelUniqueNames:[]});
 const row=rows.records[0].get('allChannelHealth')[0];
 assert.deepEqual(Object.keys(row).sort(),Object.keys(dashboardChannelHealthSelection).filter(key=>key!=='healthLabel').sort());
 assert.equal(row.channelIconURL,null);assert.equal(row.oldestOpenIssueAgeDays,null);
});
test('malformed native channel leaves remain lazy and errors follow aliases',async()=>{
 await driver.executeQuery("MATCH(ch:Channel) SET ch.displayName=['bad']");
 const skipped=await run('id broken:displayName @skip(if:true)');assert.equal(skipped.errors,undefined);
 const selected=await run('id broken:displayName');assert.deepEqual(selected.errors?.[0].path,['getServerHealthDashboard','channelHealth',0,'broken']);
});
test('single malformed native identity remains lazy but non-string tie-break retains failure',async()=>{
 await driver.executeQuery('MATCH(ch:Channel) SET ch.uniqueName=17');
 const single=await run('activityScore');assert.equal(single.errors,undefined);
 await driver.executeQuery('CREATE(:Channel {uniqueName:18})');
 const tied=await run('activityScore');assert.equal(tied.errors?.[0].message,'Failed to fetch server health dashboard');
});
test('age-list query returns numeric ages and its complete aggregate columns',async()=>{
 const {openIssueSummaryQuery}=await import('../../customResolvers/queries/getServerHealthDashboard.js');
 const empty=await driver.executeQuery(openIssueSummaryQuery,{channelUniqueNames:[]});
 assert.deepEqual(empty.records[0].keys,['totalOpenIssueCount','openIssueAges']);assert.deepEqual(empty.records[0].get('openIssueAges'),[]);
 await driver.executeQuery("CREATE(:Issue {id:'old',isOpen:true,flaggedServerRuleViolation:true,createdAt:datetime()-duration('P9D')})");
 const rows=await driver.executeQuery(openIssueSummaryQuery,{channelUniqueNames:[]});
 const ages=rows.records[0].get('openIssueAges');assert.equal(ages.length,1);assert.equal(Number(ages[0]),9);
});
