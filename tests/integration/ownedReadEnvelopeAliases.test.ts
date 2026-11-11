import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import sourceIdentity from '../../middleware/userChildIdentityMiddleware.js';
import permissions from '../../permissions.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();registerGeneratedSchema(driver,raw);schema=applyMiddleware(raw,sourceIdentity,permissions);},{timeout:240000});
after(async()=>stopNeo4j());beforeEach(async()=>{await resetDatabase(driver);await driver.executeQuery("CREATE(ch:Channel {uniqueName:'forum',displayName:'Forum'}),(d:Discussion {id:'d',title:'Discussion',createdAt:datetime('2026-01-01')}),(dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum',createdAt:datetime('2026-01-01')}) CREATE(dc)-[:POSTED_IN_CHANNEL]->(ch),(dc)-[:POSTED_IN_CHANNEL]->(d)");});
const cases=[
 ['getSiteWideDiscussionList(showArchived:false)','discussions','{id}','aggregateDiscussionCount',''],
 ['getDiscussionsInChannel(channelUniqueName:"forum")','discussionChannels','{id}','aggregateDiscussionChannelsCount',''],
 ['getSortedChannels(countDownloads:false)','channels','{uniqueName}','aggregateChannelCount',''],
 ['getSiteWideWikiList','wikiPages','{id}','aggregateWikiPageCount',''],
 ['getCommentReplies(commentId:"missing",modName:null)','ChildComments','{id}','aggregateChildCommentCount',''],
 ['getCommentSection(channelUniqueName:"forum",discussionId:"missing",modName:null)','Comments','{id}','DiscussionChannel','{id}'],
 ['getEventComments(eventId:"missing")','Comments','{id}','Event','{id}'],
 ['getDiscussionDetailAnswers(discussionId:"d",channelUniqueName:"forum")','answers','{id}','pageInfo','{hasNextPage endCursor}'],
 ['getDiscussionDetailFiles(discussionId:"d",channelUniqueName:"forum")','files','{id}','pageInfo','{hasNextPage endCursor}'],
 ['getDiscussionDetailImages(discussionId:"d",channelUniqueName:"forum")','images','{id}','pageInfo','{hasNextPage endCursor}'],
] as const;
for(const [operation,left,leftSelection,right,rightSelection] of cases)test(`${operation}: owned envelope preserves independent aliases`,async()=>{
 const run=(fields:string)=>graphql({schema,source:`{result:${operation}{${fields}}}`,contextValue:{driver,mayAccessSensitiveContent:false,req:{headers:{}},user:{username:'viewer',email:null,email_verified:true,data:null}}});
 const canonical=await run(`${left}${leftSelection} ${right}${rightSelection}`);assert.equal(canonical.errors,undefined,JSON.stringify(canonical.errors));
 const aliased=await run(`${right}:${left}${leftSelection} ${left}:${right}${rightSelection}`);assert.equal(aliased.errors,undefined,JSON.stringify(aliased.errors));
 const plain=JSON.parse(JSON.stringify(canonical.data)).result;
 assert.deepEqual(JSON.parse(JSON.stringify(aliased.data)),{result:{[right]:plain[left],[left]:plain[right]}});
});
for(const operation of [cases[0][0],cases[7][0],cases[8][0],cases[9][0]])test(`${operation}: page-info aliases preserve nullable cursors`,async()=>{
 const result=await graphql({schema,source:`{result:${operation}{regular:pageInfo{endCursor hasNextPage} swapped:pageInfo{hasNextPage:endCursor endCursor:hasNextPage}}}`,contextValue:{driver,mayAccessSensitiveContent:false,req:{headers:{}},user:{username:'viewer',email:null,email_verified:true,data:null}}});
 assert.equal(result.errors,undefined);const value=JSON.parse(JSON.stringify(result.data)).result;
 assert.deepEqual(value.swapped,{hasNextPage:value.regular.endCursor,endCursor:value.regular.hasNextPage});
});
test('owned envelopes retain fragment and directive variable semantics',async()=>{
 const source='query($show:Boolean!){getSiteWideDiscussionList(showArchived:false){...Fields}} fragment Fields on SiteWideDiscussionListFormat{discussions:aggregateDiscussionCount aggregateDiscussionCount:discussions @include(if:$show){id}}';
 for(const show of [false,true]){
 const result=await graphql({schema,source,variableValues:{show},contextValue:{driver,mayAccessSensitiveContent:false,req:{headers:{}},user:{username:'viewer',email:null,email_verified:true,data:null}}});assert.equal(result.errors,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{getSiteWideDiscussionList:{discussions:1,...(show?{aggregateDiscussionCount:[{id:'d'}]}:{})}});
 }
});

test('omitted site-wide archive option matches the supported explicit-null filter',async()=>{
 const run=(args:string)=>graphql({schema,source:`{getSiteWideDiscussionList${args}{aggregateDiscussionCount discussions{id}}}`,contextValue:{driver,mayAccessSensitiveContent:false,req:{headers:{}},user:{username:'viewer',email:null,email_verified:true,data:null}}});
 const omitted=await run('');const explicit=await run('(showArchived:null)');assert.equal(omitted.errors,undefined);assert.equal(explicit.errors,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(omitted.data)),JSON.parse(JSON.stringify(explicit.data)));
});
test('actual site-wide count and page variants retain their declared columns',async()=>{
 const {buildSiteWideDiscussionPageQueries}=await import('../../customResolvers/cypher/buildSiteWideDiscussionPageQueries.js');
 for(const sortOption of ['new','top','hot'] as const){
 const {countQuery,pageQuery}=buildSiteWideDiscussionPageQueries({hasDownload:null,hasSearch:false,hasSelectedChannels:false,hasSelectedTags:false,showArchived:false,sortOption});
 const params={mayAccessSensitiveContent:false,startOfTimeFrame:'2025-01-01',pageLimit:2,hotAgeOffsetMonths:1,hotGravity:1,rankingAnchor:'2026-02-01'};
 const count=await driver.executeQuery(countQuery,params);assert.deepEqual(count.records[0].keys,['totalCount']);assert.equal(Number(count.records[0].get('totalCount')),1);
 const page=await driver.executeQuery(pageQuery,params);assert.equal(page.records.length,1);assert.deepEqual(page.records[0].keys,['discussionId','cursorCreatedAt','cursorScore']);
 assert.equal(page.records[0].get('discussionId'),'d');assert.ok(page.records[0].get('cursorCreatedAt'));
 }
});
