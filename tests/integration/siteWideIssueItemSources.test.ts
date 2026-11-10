import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import permissions from '../../permissions.js';
import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{
 driver=await startNeo4j();const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();
 registerGeneratedSchema(driver,raw);schema=applyMiddleware(raw,sourceIdentity,permissions);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 await resetDatabase(driver);
 await driver.executeQuery(`CREATE(u:User {username:'owner'}),(m:ModerationProfile {displayName:'public-mod'}),(ch:Channel {uniqueName:'forum',channelIconURL:'icon'}),
 (i:Issue {id:'issue',issueNumber:7,title:'Title',body:'Body',isOpen:true,createdAt:datetime('2026-01-01'),channelUniqueName:'forum'})
 CREATE(m)-[:AUTHORED_ISSUE]->(i),(u)-[:MODERATION_PROFILE]->(m),(ch)-[:HAS_ISSUE]->(i)`);
});
const execute=(fields:string,extra='',username:string|undefined='owner',variables?:Record<string,unknown>)=>graphql({schema,source:`query($skip:Boolean! = false){getSiteWideIssueList(isOpen:true,showOnlyServerRuleViolations:false${extra}){aggregateIssueCount issues{${fields}}}}`,variableValues:variables,contextValue:{driver,mayAccessSensitiveContent:false,user:username?{username,email:null,email_verified:true,data:null}:undefined}});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
test('site-wide issue item aliases preserve canonical source fields',async()=>{
 const result=await execute('id title:id body:authorName reportCount @skip(if:$skip)');
 assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data),{getSiteWideIssueList:{aggregateIssueCount:1,issues:[{id:'issue',title:'issue',body:'public-mod',reportCount:0}]}});
});
test('issue items preserve fragment selections and lazy scalar error paths',async()=>{
 await driver.executeQuery("MATCH(i:Issue) SET i.body=['bad']");
 const skipped=await execute('... on SiteWideIssueListItem{id title:id invalid:body @skip(if:$skip)}','', 'owner',{skip:true});
 assert.equal(skipped.errors,undefined);
 const selected=await execute('id invalid:body @skip(if:$skip)');
 assert.deepEqual(selected.errors?.[0].path,['getSiteWideIssueList','issues',0,'invalid']);
});

test('executed issue query emits every fixed selected key, including absent nullable values',async()=>{
 const {buildSiteWideIssuesQuery}=await import('../../customResolvers/cypher/buildContentSearchQueries.js');
 const {siteWideIssueItemSelection}=await import('../../customResolvers/contracts/siteWideIssueItems.js');
 const rows=await driver.executeQuery(buildSiteWideIssuesQuery(false),{isOpen:true,selectedChannels:[],showOnlyServerRuleViolations:false,startDate:null,endDate:null,mayAccessSensitiveContent:false,filterCreatedByMe:false,filterIAmOP:false,filterIReported:false,loggedInUsername:'owner',loggedInModProfileName:null,sort:'newest',offset:0,limit:10});
 const item=rows.records[0].get('issue');assert.deepEqual(Object.keys(item).sort(),Object.keys(siteWideIssueItemSelection).sort());
 assert.equal(item.updatedAt,null);assert.equal(item.relatedEventId,null);assert.equal(item.authorName,'public-mod');
});
for(const actor of ['owner','outsider',''])test(`site issue list keeps public moderator identity for ${actor||'anonymous'}`,async()=>{
 const result=await execute('authorName reportCount @skip(if:$skip)','',actor);assert.equal(result.errors,undefined);
 assert.equal(plain(result.data).getSiteWideIssueList.issues[0].authorName,'public-mod');
});
test('identity filters and exhausted pagination retain empty results',async()=>{
 const anonymous=await execute('id @skip(if:$skip)',',filterCreatedByMe:true','');assert.equal(anonymous.errors,undefined);
 assert.deepEqual(plain(anonymous.data),{getSiteWideIssueList:{aggregateIssueCount:0,issues:[]}});
 const page=await execute('id @skip(if:$skip)',',options:{offset:1}');assert.equal(page.errors,undefined);
 assert.deepEqual(plain(page.data),{getSiteWideIssueList:{aggregateIssueCount:0,issues:[]}});
});
test('sensitive targets remain excluded before item serialization',async()=>{
 await driver.executeQuery("MATCH(i:Issue) CREATE(i)-[:TARGETS_DISCUSSION]->(:Discussion {hasSensitiveContent:true})");
 const result=await execute('id @skip(if:$skip)');assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{getSiteWideIssueList:{aggregateIssueCount:0,issues:[]}});
});
