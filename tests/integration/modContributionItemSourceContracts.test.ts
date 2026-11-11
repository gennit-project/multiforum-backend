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
before(async()=>{driver=await startNeo4j();const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();registerGeneratedSchema(driver,raw);schema=applyMiddleware(raw,sourceIdentity,permissions);},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 await resetDatabase(driver);
 await driver.executeQuery(`CREATE(mod:ModerationProfile {displayName:'moderator'}),(u:User {username:'private-account'}),(ch:Channel {uniqueName:'forum'}),
 (d:Discussion {id:'d',title:'Discussion',createdAt:datetime('2026-01-01T01:00:00Z')}),
 (dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum'}),
 (c:Comment {id:'c',text:'Comment',createdAt:datetime('2026-01-01T03:00:00Z')}),
 (e:Event {id:'e',title:'Event',createdAt:datetime('2026-01-01T04:00:00Z')}),(ec:EventChannel {id:'ec',eventId:'e',channelUniqueName:'forum'}),
 (i:Issue {id:'i',issueNumber:7,title:'Issue',channelUniqueName:'forum',isOpen:true}),
 (a:ModerationAction {id:'a',actionType:'test',actionDescription:'Action',createdAt:datetime('2026-01-01T05:00:00Z')}),
 (f:Comment {id:'f',text:'Feedback',isFeedbackComment:true,createdAt:datetime('2026-01-01T06:00:00Z')})
 CREATE(u)-[:MODERATION_PROFILE]->(mod),(u)-[:POSTED_DISCUSSION]->(d),(dc)-[:POSTED_IN_CHANNEL]->(d),(dc)-[:POSTED_IN_CHANNEL]->(ch),
 (dc)-[:CONTAINS_COMMENT]->(c),(ec)-[:POSTED_IN_CHANNEL]->(e),(ec)-[:POSTED_IN_CHANNEL]->(ch),(e)-[:HAS_COMMENT]->(c),
 (mod)-[:PERFORMED_MODERATION_ACTION]->(a),(a)-[:MODERATED_COMMENT]->(c),(i)-[:ACTIVITY_ON_ISSUE]->(a),
 (i)-[:TARGETS_DISCUSSION]->(d),(i)-[:TARGETS_EVENT]->(e),(i)-[:TARGETS_COMMENT]->(c),
 (mod)-[:AUTHORED_COMMENT]->(f),(f)-[:HAS_FEEDBACK_COMMENT]->(d),(f)-[:HAS_FEEDBACK_COMMENT]->(e),(f)-[:HAS_FEEDBACK_COMMENT]->(c)`);
});
const context=(username?:string)=>({driver,mayAccessSensitiveContent:false,user:username?{username,email:null,email_verified:true,data:null}:undefined});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const query=(fields:string)=>`{result:getModContributions(displayName:"moderator",year:2026){${fields}}}`;
test('moderation day and action aliases retain their selected field meaning',async()=>{
 const result=await graphql({schema,source:query('date:count activities{id:actionType actionType:actionDescription}'),contextValue:context()});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{result:[{date:2,activities:[{id:'test',actionType:'Action'},{id:'feedback',actionType:'Left feedback on a discussion'}]}]});
});
test('moderation fixed children preserve aliases without fetching private author data',async()=>{
 const result=await graphql({schema,source:`query($show:Boolean!){result:getModContributions(displayName:"moderator",year:2026){activities{Comment{id:text} Issue{id:title title:issueNumber} RelatedDiscussion{id:title Author{username} DiscussionChannels{id:channelUniqueName}} RelatedEvent{id:title EventChannels{id:eventId}} RelatedComment{id:text Event{id:title EventChannels{id:channelUniqueName}} DiscussionChannel{id:discussionId}} created:createdAt @include(if:$show)}}}`,variableValues:{show:false},contextValue:context()});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const related={RelatedDiscussion:{id:'Discussion',Author:null,DiscussionChannels:[{id:'forum'}]},RelatedEvent:{id:'Event',EventChannels:[{id:'e'}]},RelatedComment:{id:'Comment',Event:{id:'Event',EventChannels:[{id:'forum'}]},DiscussionChannel:{id:'d'}}};
 assert.deepEqual(plain(result.data),{result:[{activities:[{Comment:{id:'Comment'},Issue:{id:'Issue',title:7},...related},{Comment:{id:'Feedback'},Issue:null,...related}]}]});
 assert.ok(!JSON.stringify(result.data).includes('private-account'));
});

function keys(value:unknown,selection:unknown,path='activity'):void {
 if(value===null)return;
 if(Array.isArray(value)){for(const item of value)keys(item,selection,path);return;}
 assert.ok(value&&typeof value==='object',path);
 assert.ok(selection&&typeof selection==='object');
 assert.deepEqual(Object.keys(value).sort(),Object.keys(selection).sort(),path);
 for(const [key,nested] of Object.entries(selection))if(nested!==true)keys(Reflect.get(value,key),nested,`${path}.${key}`);
}
test('both actual moderation branches emit every declared nested map key',async()=>{
 const [{default:getMod},{modContributionItemSelection}]=await Promise.all([
  import('../../customResolvers/queries/getModContributions.js'),
  import('../../customResolvers/contracts/modContributionItemSelection.js'),
 ]);
 const days=await getMod({driver})(null,{displayName:'moderator',year:2026},context());
 assert.equal(days.length,1);assert.equal(days[0].activities.length,2);
 for(const item of days[0].activities){
  assert.ok(item.Comment&&item.RelatedDiscussion&&item.RelatedEvent&&item.RelatedComment);
  assert.ok(item.RelatedComment.Event&&item.RelatedComment.DiscussionChannel);
  assert.equal(item.RelatedDiscussion.DiscussionChannels.length,1);
  assert.equal(item.RelatedEvent.EventChannels.length,1);
  keys(item,modContributionItemSelection);
 }
});
test('omitted malformed values stay lazy; selected errors retain aliased paths',async()=>{
 await driver.executeQuery("MATCH(i:Issue) SET i.title=['invalid']");
 const source='query($show:Boolean!)'+query('activities{Issue{...IssueFields}}')+' fragment IssueFields on IssueInfo{label:title @include(if:$show)}';
 const skipped=await graphql({schema,source,variableValues:{show:false},contextValue:context()});assert.equal(skipped.errors,undefined);
 const selected=await graphql({schema,source,variableValues:{show:true},contextValue:context()});
 assert.deepEqual(selected.errors?.[0].path,['result',0,'activities',0,'Issue','label']);
});
test('missing targets stay nullable and channel collections stay empty',async()=>{
 await driver.executeQuery('MATCH(n) WHERE n:Issue OR n:Event OR n:DiscussionChannel OR n:EventChannel DETACH DELETE n');
 const result=await graphql({schema,source:query('activities{Issue{id} RelatedEvent{id} RelatedDiscussion{DiscussionChannels{id}} RelatedComment{Event{id} DiscussionChannel{id}}}'),contextValue:context()});
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{result:[{activities:[
  {Issue:null,RelatedEvent:null,RelatedDiscussion:null,RelatedComment:null},
  {Issue:null,RelatedEvent:null,RelatedDiscussion:{DiscussionChannels:[]},RelatedComment:{Event:null,DiscussionChannel:null}},
 ]}]});
});
test('public activity does not expose human identity for anonymous, other or backing account viewers',async()=>{
 for(const actor of [undefined,'other','private-account']){
  const result=await graphql({schema,source:query('activities{RelatedDiscussion{Author{username Email{address}}} Comment{CommentAuthor{username}} RelatedComment{CommentAuthor{username}}}'),contextValue:context(actor)});
  assert.equal(result.errors,undefined);
  assert.deepEqual(plain(result.data),{result:[{activities:[0,1].map(()=>({RelatedDiscussion:{Author:null},Comment:{CommentAuthor:null},RelatedComment:{CommentAuthor:null}}))}]});
 }
});
test('legacy issue scalar targets retain the same fixed related-item sources',async()=>{
 await driver.executeQuery("MATCH(i:Issue)-[r]->(target) WHERE type(r) IN ['TARGETS_DISCUSSION','TARGETS_EVENT','TARGETS_COMMENT'] DELETE r SET i.relatedDiscussionId='d',i.relatedEventId='e',i.relatedCommentId='c'");
 const result=await graphql({schema,source:query('activities{RelatedDiscussion{id} RelatedEvent{id} RelatedComment{id}}'),contextValue:context()});
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{result:[{activities:[0,1].map(()=>({RelatedDiscussion:{id:'d'},RelatedEvent:{id:'e'},RelatedComment:{id:'c'}}))}]});
});
