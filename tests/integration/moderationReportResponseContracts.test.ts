import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import permissions from '../../permissions.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {appendModerationActions} from '../../services/persistence/moderationIssueWrites.js';
import {createCommentReportRepository} from '../../services/persistence/commentReportRepository.js';
import reportComment from '../../customResolvers/mutations/reportComment.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema,secured:GraphQLSchema;
let failAppend=false,deleteBeforeAppend=false;
before(async()=>{driver=await startNeo4j();const app=getResolvers(driver).resolvers;const base=createCommentReportRepository(driver);const repository={...base,appendReport:async(params:Parameters<typeof base.appendReport>[0])=>{if(failAppend)throw Error('write fixture failure');if(deleteBeforeAppend)await driver.executeQuery('MATCH(i:Issue{id:$id}) DETACH DELETE i',{id:params.issueId});return base.appendReport(params);}};
 schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:{...app,Mutation:{...app.Mutation,reportComment:reportComment({driver,commentReportRepository:repository})}},features:{filters:{String:{MATCHES:true}}}}).getSchema();registerGeneratedSchema(driver,schema);secured=applyMiddleware(schema,permissions);
},{timeout:240000});after(async()=>{await stopNeo4j();});
beforeEach(async()=>{await resetDatabase(driver);failAppend=false;deleteBeforeAppend=false;await driver.executeQuery(`CREATE(u:User{username:'actor',profilePicURL:'https://invalid.test/pic',createdAt:datetime()}),(m:ModerationProfile{displayName:'Moderator',createdAt:datetime()}),(ch:Channel{uniqueName:'forum',displayName:'Forum',channelIconURL:'https://invalid.test/icon',createdAt:datetime()}),(c:Comment{id:'comment',text:'Comment',createdAt:datetime()}),(d:Discussion{id:'discussion',title:'Discussion',createdAt:datetime()}),(e:Event{id:'event',title:'Event',createdAt:datetime()}),(im:Image{id:'image',url:'https://invalid.test/image'}),(w:WikiPage{id:'wiki',title:'Wiki',body:'Body',slug:'wiki',channelUniqueName:'forum',createdAt:datetime()}),(:ServerConfig{serverName:'server'}) CREATE(u)-[:MODERATION_PROFILE]->(m),(u)-[:ADMIN_OF_CHANNEL]->(ch),(u)-[:AUTHORED_COMMENT]->(c),(u)-[:AUTHORED_DISCUSSION]->(d),(u)-[:UPLOADED_IMAGE]->(im),(ch)-[:OWNS_WIKI_PAGE]->(w)`);});
const calls={
 reportComment:'commentId:"comment",channelUniqueName:"forum",reportText:"reason",selectedForumRules:[],selectedServerRules:["rule"]',
 reportDiscussion:'discussionId:"discussion",channelUniqueName:"forum",reportText:"reason",selectedForumRules:[],selectedServerRules:["rule"]',
 reportEvent:'eventId:"event",channelUniqueName:"forum",reportText:"reason",selectedForumRules:[],selectedServerRules:["rule"]',
 reportWikiEdit:'wikiPageId:"wiki",channelUniqueName:"forum",reportText:"reason",selectedForumRules:[],selectedServerRules:["rule"]',
 reportImage:'imageId:"image",channelUniqueName:"forum",reportText:"reason",selectedForumRules:[],selectedServerRules:["rule"]',
 reportChannel:'channelUniqueName:"forum",reportText:"reason",selectedServerRules:["rule"]',
 reportChannelImage:'channelUniqueName:"forum",imageType:ICON,reportText:"reason",selectedServerRules:["rule"]',
 reportProfilePicture:'username:"actor",reportText:"reason",selectedServerRules:["rule"]',
};
function execute(name:keyof typeof calls,fields='id isOpen flaggedServerRuleViolation',secure=false,authenticated=true){return graphql({schema:secure?secured:schema,source:`mutation{${name}(${calls[name]}){${fields}}}`,contextValue:{driver,req:{headers:{}},user:authenticated?{username:'actor',email:null,email_verified:true,data:{ModerationProfile:{displayName:'Moderator'}}}:undefined,mayAccessSensitiveContent:false}});}
function data(result:Awaited<ReturnType<typeof execute>>){assert.equal(result.errors,undefined,JSON.stringify(result.errors));return JSON.parse(JSON.stringify(result.data));}
for(const name of Object.keys(calls) as (keyof typeof calls)[])test(`${name} selects only guaranteed writes, reopens repeats, and retains caller-field serialization`,async()=>{
 const first=data(await execute(name))[name];assert.equal(typeof first.id,'string');assert.equal(first.isOpen,true);assert.equal(first.flaggedServerRuleViolation,true);
 await driver.executeQuery('MATCH(i:Issue{id:$id}) SET i.isOpen=false,i.body=[123]',{id:first.id});
 const repeat=data(await execute(name))[name];assert.deepEqual(repeat,first);
 const malformed=await execute(name,'id body');assert.match(malformed.errors?.[0].message??'',/String cannot represent/);assert.deepEqual(malformed.errors?.[0].path,[name,'body']);
 const stored=await driver.executeQuery('MATCH(i:Issue{id:$id}) RETURN i.isOpen AS open,i.body AS body',{id:first.id});assert.equal(stored.records[0].get('open'),true);assert.equal(Number(stored.records[0].get('body')[0]),123);
});
test('all report middleware rejects anonymous requests without Issue writes',async()=>{for(const name of Object.keys(calls) as (keyof typeof calls)[])assert.ok((await execute(name,'id',true,false)).errors,name);assert.equal(Number((await driver.executeQuery('MATCH(i:Issue) RETURN count(i) AS n')).records[0].get('n')),0);});
test('append failure retains prior creation and existing resolver error wrapper',async()=>{failAppend=true;const result=await execute('reportComment');assert.match(result.errors?.[0].message??'',/Error updating issue/);assert.equal(result.data?.reportComment,null);assert.equal(Number((await driver.executeQuery('MATCH(i:Issue) RETURN count(i) AS n')).records[0].get('n')),1);});
test('concurrent deletion retains empty append result and existing guarded error',async()=>{deleteBeforeAppend=true;const result=await execute('reportComment');assert.ok(result.errors);assert.equal(result.data?.reportComment,null);assert.equal(Number((await driver.executeQuery('MATCH(i:Issue) RETURN count(i) AS n')).records[0].get('n')),0);});
test('shared append leaves unspecified persisted flags unknown and preserves original conversion',async()=>{
 await driver.executeQuery("CREATE(:Issue{id:'raw',isOpen:'malformed',flaggedServerRuleViolation:17,body:123,issueNumber:4})");const raw=(await appendModerationActions(driver,{issueId:'raw',actions:[]})).issues[0];assert.equal(raw.isOpen,'malformed');assert.equal(raw.flaggedServerRuleViolation,17);assert.equal(raw.issueNumber,4);
 const closed=(await appendModerationActions(driver,{issueId:'raw',actions:[],isOpen:false})).issues[0];assert.equal(closed.isOpen,false);assert.equal(closed.flaggedServerRuleViolation,17);assert.deepEqual((await appendModerationActions(driver,{issueId:'missing',actions:[],isOpen:true,flaggedServerRuleViolation:true})).issues,[]);
});
test('authenticated channel owner can report through permission middleware',async()=>{const row=data(await execute('reportComment','id isOpen flaggedServerRuleViolation',true)).reportComment;assert.equal(row.isOpen,true);assert.equal(row.flaggedServerRuleViolation,true);});
