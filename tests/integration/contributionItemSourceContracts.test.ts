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
 await driver.executeQuery(`CREATE(u:User {username:'actor',displayName:'Actor',profilePicURL:'pic',createdAt:datetime()}),(ch:Channel {uniqueName:'forum',createdAt:datetime()}),
 (d:Discussion {id:'d',title:'Discussion',hasDownload:false,createdAt:datetime('2026-01-01T01:00:00Z')}),
 (dl:Discussion {id:'dl',title:'Download',hasDownload:true,createdAt:datetime('2026-01-01T02:00:00Z')}),
 (dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum'}),(dc2:DiscussionChannel {id:'dc2',discussionId:'dl',channelUniqueName:'forum'}),
 (c:Comment {id:'c',text:'Comment',createdAt:datetime('2026-01-01T03:00:00Z')}),
 (e:Event {id:'e',title:'Event',createdAt:datetime('2026-01-01T04:00:00Z')}),(ec:EventChannel {id:'ec',eventId:'e',channelUniqueName:'forum'}),
 (w:WikiPage {id:'w',title:'Wiki',slug:'wiki'}),(v:TextVersion {id:'v',body:'Edit',editReason:'Reason',createdAt:datetime('2026-01-01T05:00:00Z')})
 CREATE(u)-[:POSTED_DISCUSSION]->(d),(u)-[:POSTED_DISCUSSION]->(dl),(dc)-[:POSTED_IN_CHANNEL]->(d),(dc)-[:POSTED_IN_CHANNEL]->(ch),
 (dc2)-[:POSTED_IN_CHANNEL]->(dl),(dc2)-[:POSTED_IN_CHANNEL]->(ch),(u)-[:AUTHORED_COMMENT]->(c),(dc)-[:CONTAINS_COMMENT]->(c),
 (u)-[:POSTED_BY]->(e),(ec)-[:POSTED_IN_CHANNEL]->(e),(ec)-[:POSTED_IN_CHANNEL]->(ch),(e)-[:HAS_COMMENT]->(c),
 (u)-[:AUTHORED_VERSION]->(v),(w)-[:HAS_VERSION]->(v),(ch)-[:OWNS_WIKI_PAGE]->(w)`);
});
const context=(username:string|null='actor')=>({driver,mayAccessSensitiveContent:false,user:username?{username,email:null,email_verified:true,data:null}:undefined});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const root=(kind:'user'|'channel',fields:string)=>kind==='user'?`{result:getUserContributions(username:"actor",year:2026){${fields}}}`:`{result:getChannelContributions(channelUniqueName:"forum",year:2026){dayData{${fields}}}}`;
for(const kind of ['user','channel'] as const)test(`${kind} contribution fixed author maps preserve colliding aliases`,async()=>{
 const result=await graphql({schema,source:root(kind,'activities{Comments{CommentAuthor{username:profilePicURL}}}'),contextValue:context(null)});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const day={activities:[{Comments:[{CommentAuthor:{username:'pic'}}]}]};
 assert.deepEqual(plain(result.data),{result:kind==='user'?[day]:[{dayData:[day]}]});
});
for(const kind of ['user','channel'] as const)test(`${kind} contribution count and activity aliases retain field meaning`,async()=>{
 const result=await graphql({schema,source:root(kind,'date:count activities{id:type Comments{id:text}}'),contextValue:context(null)});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const day={date:kind==='user'?5:3,activities:[{id:'activity',Comments:[{id:'Comment'}]}]};
 assert.deepEqual(plain(result.data),{result:kind==='user'?[day]:[{dayData:[day]}]});
});
test('channel contribution categories absent from its source scope are empty lists',async()=>{
 const result=await graphql({schema,source:root('channel','activities{Downloads{id} Events{id} WikiEdits{id}}'),contextValue:context(null)});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{result:[{dayData:[{activities:[{Downloads:[],Events:[],WikiEdits:[]}]}]}]});
});

function keys(value:unknown,selection:unknown,path='activity'):void {
 if(value===null)return;
 if(Array.isArray(value)){for(const item of value)keys(item,selection,path);return;}
 assert.ok(value&&typeof value==='object',path);
 assert.ok(selection&&typeof selection==='object');
 const actual=Object.keys(value).filter(key=>key!=='hasDownload'); // private query discriminator
 assert.deepEqual(actual.sort(),Object.keys(selection).sort(),path);
 for(const [key,nested] of Object.entries(selection))if(nested!==true)keys(Reflect.get(value,key),nested,`${path}.${key}`);
}
test('user and channel queries retain every selected nested item key',async()=>{
 const [{default:user},{default:channel},selections]=await Promise.all([
  import('../../customResolvers/queries/getUserContributions.js'),
  import('../../customResolvers/queries/getChannelContributions.js'),
  import('../../customResolvers/contracts/contributionItemSelections.js'),
 ]);
 const users=await user({driver})(null,{username:'actor',year:2026},context());
 const channels=await channel({driver})(null,{channelUniqueName:'forum',year:2026},context());
 assert.equal(users.length,1);assert.equal(channels.length,1);
 for(const activity of users[0].activities){
  for(const field of ['Comments','Discussions','Downloads','Events','WikiEdits'] as const)assert.equal(activity[field].length,1,field);
  keys(activity,selections.userContributionActivitySelection);
 }
 for(const activity of channels[0].dayData[0].activities)keys(activity,selections.channelContributionActivitySelection);
});
test('all user item kinds preserve aliases, fragments and directive variables',async()=>{
 const result=await graphql({schema,source:`query($show:Boolean!){getUserContributions(username:"actor",year:2026){activities{
 Comments{id:text DiscussionChannel{id:discussionId} Event{id:title}}
 Discussions{id:title Author{...Actor} DiscussionChannels{id:channelUniqueName}}
 Downloads{id:title Author{...Actor}}
 Events{id:title Poster{...Actor} EventChannels{id:channelUniqueName}}
 WikiEdits{id:body Author{...Actor} WikiPage{id:title title:slug}}
 }}} fragment Actor on User{username:profilePicURL @include(if:$show)}`,variableValues:{show:true},contextValue:context(null)});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{getUserContributions:[{activities:[{
 Comments:[{id:'Comment',DiscussionChannel:{id:'d'},Event:{id:'Event'}}],
 Discussions:[{id:'Discussion',Author:{username:'pic'},DiscussionChannels:[{id:'forum'}]}],
 Downloads:[{id:'Download',Author:{username:'pic'}}],Events:[{id:'Event',Poster:{username:'pic'},EventChannels:[{id:'forum'}]}],
 WikiEdits:[{id:'Edit',Author:{username:'pic'},WikiPage:{id:'Wiki',title:'wiki'}}],
 }]}]});
});
for(const kind of ['user','channel'] as const)test(`${kind} author identity preserves owner authorization with colliding aliases`,async()=>{
 for(const actor of ['actor','outsider',null]){
  const fields=kind==='user'?'Comments{CommentAuthor{username:profilePicURL contact:Email{address}}} Discussions{Author{username:profilePicURL contact:Email{address}}} Downloads{Author{username:profilePicURL contact:Email{address}}} Events{Poster{username:profilePicURL contact:Email{address}}} WikiEdits{Author{username:profilePicURL contact:Email{address}}}':'Comments{CommentAuthor{username:profilePicURL contact:Email{address}}} Discussions{Author{username:profilePicURL contact:Email{address}}}';
  const result=await graphql({schema,source:root(kind,`activities{${fields}}`),contextValue:context(actor)});
  assert.equal(result.errors?.length??0,actor==='actor'?0:kind==='user'?5:3,JSON.stringify(result.errors));
  assert.ok(result.data);assert.ok(JSON.stringify(result.data).includes('"username":"pic","contact":null'));
 }
});
for(const kind of ['user','channel'] as const)test(`${kind} malformed unrequested scalar stays lazy and nullable relations stay null`,async()=>{
 await driver.executeQuery("MATCH(u:User) SET u.profilePicURL=['invalid'] WITH u MATCH(e:Event) DETACH DELETE e");
 const source='query($show:Boolean!)'+root(kind,'activities{Comments{Channel{uniqueName} CommentAuthor{picture:profilePicURL @include(if:$show)}}}');
 const skipped=await graphql({schema,source,variableValues:{show:false},contextValue:context(null)});
 assert.equal(skipped.errors,undefined,JSON.stringify(skipped.errors));
 const selected=await graphql({schema,source,variableValues:{show:true},contextValue:context(null)});
 assert.ok(selected.errors?.some(error=>error.path?.includes('picture')));
 assert.ok(JSON.stringify(skipped.data).includes('"Channel":null'));
});
test('channel raw usernames coerce publicly but do not grant string-matched owner access',async()=>{
 await driver.executeQuery('MATCH(u:User) SET u.username=true');
 const result=await graphql({schema,source:root('channel','activities{Comments{CommentAuthor{username Email{address}}}}'),contextValue:context('true')});
 assert.equal(result.errors?.length,1,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{result:[{dayData:[{activities:[{Comments:[{CommentAuthor:{username:'true',Email:null}}]}]}]}]});
});
test('user nullable comment relations remain absent without generating fallback data',async()=>{
 await driver.executeQuery('MATCH(dc:DiscussionChannel)-[r:CONTAINS_COMMENT]->(:Comment) DELETE r');
 await driver.executeQuery('MATCH(e:Event) DETACH DELETE e');
 const result=await graphql({schema,source:root('user','activities{Comments{DiscussionChannel{id} Event{id}}}'),contextValue:context(null)});
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{result:[{activities:[{Comments:[{DiscussionChannel:null,Event:null}]}]}]});
});
