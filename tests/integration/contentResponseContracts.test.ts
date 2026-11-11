import permissions from "../../permissions.js";
import sourceIdentity from "../../middleware/userChildIdentityMiddleware.js";
import { applyMiddleware } from "graphql-middleware";
import createDiscussion from "../../customResolvers/mutations/createDiscussionWithChannelConnections.js";
import createEvent from "../../customResolvers/mutations/createEventWithChannelConnections.js";
import { createDiscussionCreationRepository } from "../../services/persistence/discussionCreationRepository.js";
import { createEventWriteRepository } from "../../services/persistence/eventWriteRepository.js";
import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
before(async () => {
 driver = await startNeo4j();
 schema = await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers,features:{filters:{String:{MATCHES:true}}}}).getSchema();
 registerGeneratedSchema(driver,schema);
 secured=applyMiddleware(schema,permissions,sourceIdentity);
 schema=applyMiddleware(schema,sourceIdentity);
}, {timeout:240000});
after(async () => stopNeo4j());
beforeEach(async () => {
 await resetDatabase(driver);
 await driver.executeQuery(`CREATE (a:User {username:'alice',createdAt:datetime()}),(b:User {username:'bob',createdAt:datetime()}),
 (c:Channel {uniqueName:'forum',createdAt:datetime(),wikiEnabled:true})
 CREATE (a)-[:ADMIN_OF_CHANNEL]->(c)`);
});
const run = (source:string, variables:Record<string,unknown> = {}, username="alice") => graphql({schema,source,variableValues:variables,
 contextValue:{driver,req:{headers:{}},user:{username,email:null,email_verified:true,data:null},mayAccessSensitiveContent:false}});
function data(result:Awaited<ReturnType<typeof run>>) {
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 return JSON.parse(JSON.stringify(result.data));
}
for (const [name,label,edge,authorEdge] of [
 ["deleteCommentRevision","Comment","HAS_VERSION","AUTHORED_COMMENT"],
 ["deleteDiscussionBodyRevision","Discussion","HAS_BODY_VERSION","POSTED_DISCUSSION"],
 ["deleteEventDescriptionRevision","Event","HAS_DESCRIPTION_VERSION","POSTED_BY"],
 ["deleteWikiRevision","WikiPage","HAS_VERSION","AUTHORED_WIKI_PAGE"],
] as const) {
 const source=`mutation($id:ID!){value:${name}(textVersionId:$id){id body editReason createdAt updatedAt Author{username}}}`;
 async function seed() {
  await driver.executeQuery(`MATCH(a:User {username:'alice'}),(c:Channel)
  CREATE (p:${label} {id:'p',title:'Parent',createdAt:datetime(),channelUniqueName:'forum'})-[:${edge}]->(v:TextVersion {id:'v',body:'Prior',createdAt:datetime('2026-01-01T00:00:00Z')})
  CREATE (a)-[:${authorEdge}]->(p) CREATE(a)-[:AUTHORED_VERSION]->(v) CREATE(c)-[:OWNS_WIKI_PAGE]->(p)`);
 }
 test(`${name}: selected response fields serialize on redaction and repeated redaction`,async()=>{
  await seed();
  for(let i=0;i<2;i++) {
   const result=data(await run(source,{id:'v'})).value;
   assert.equal(result.id,'v');assert.equal(result.body,'[deleted]');assert.equal(result.editReason,null);
   assert.equal(result.createdAt,'2026-01-01T00:00:00.000Z');assert.equal(result.Author.username,'alice');
   assert.equal(typeof result.updatedAt,'string');
   assert.equal((await driver.executeQuery("MATCH(v:TextVersion {id:'v'}) RETURN v.body AS body")).records[0].get('body'),'[deleted]');
  }
 });
 test(`${name}: revision response preserves body/id collisions`,async()=>{
  await seed();const result=data(await run(`mutation{value:${name}(textVersionId:"v"){id:body body:id Author{name:username}}}`)).value;
  assert.deepEqual(result,{id:'[deleted]',body:'v',Author:{name:'alice'}});
 });
 test(`${name}: missing and unauthorized revisions return nullable errors without redacting`,async()=>{
  await seed();
  for(const [id,actor] of [['missing','alice'],['v','bob']]) {
   const result=await run(source,{id},actor);assert.equal(result.data?.value,null);assert.ok(result.errors);
  }
  assert.equal((await driver.executeQuery("MATCH(v:TextVersion {id:'v'}) RETURN v.body AS body")).records[0].get('body'),'Prior');
 });
}
test('album add/remove Boolean results preserve ownership, duplicate and missing edge behavior',async()=>{
 await driver.executeQuery("MATCH(a:User {username:'alice'}) CREATE(a)-[:HAS_ALBUM]->(:Album {id:'album'}),(:Image {id:'image'})");
 const source=(name:string)=>`mutation{value:${name}(albumId:"album",imageId:"image")}`;
 assert.equal(data(await run(source('addImageToAlbum'))).value,true);
 assert.ok((await run(source('addImageToAlbum'))).errors);
 assert.ok((await run(source('removeImageFromAlbum'),{},'bob')).errors);
 assert.equal(data(await run(source('removeImageFromAlbum'))).value,true);
 assert.equal(data(await run(source('removeImageFromAlbum'))).value,true);
 assert.equal((await driver.executeQuery('MATCH(:Album)-[r:HAS_IMAGE]->() RETURN r')).records.length,0);
});
test('owned comment mutation serializes its fixed scalar projection and rejects invalid scalar input',async()=>{
 const source=`mutation($input:[OwnedCommentCreateInput!]!){createCommentWithOwnedConnections(input:$input){comments{id text isRootComment isFeedbackComment deleted archived weightedVotesCount botMentions createdAt}}}`;
 const result=data(await run(source,{input:[{text:'Hello',isRootComment:true,isFeedbackComment:false}]})).createCommentWithOwnedConnections.comments[0];
 assert.equal(result.text,'Hello');assert.equal(result.isRootComment,true);assert.equal(result.isFeedbackComment,false);
 assert.equal(typeof result.id,'string');assert.equal(typeof result.createdAt,'string');
 assert.equal(result.botMentions,null);assert.equal(result.weightedVotesCount,null);
 const invalid=await run(source,{input:[{text:{bad:'value'},isRootComment:true}]});assert.ok(invalid.errors);
 assert.equal((await driver.executeQuery('MATCH(c:Comment) RETURN c')).records.length,1);
});
test('event create response serializes selected scalars, nested channels and empty lists',async()=>{
 const source=`mutation($input:[EventCreateInputWithChannels!]!){createEventWithChannelConnections(input:$input){id title description startTime endTime canceled Poster{username} EventChannels{id channelUniqueName Channel{uniqueName} Event{id}} SubscribedToNotifications{username} SubscribedToEventUpdates{username} Tags{text} createdAt updatedAt}}`;
 const result=data(await run(source,{input:[{eventCreateInput:{title:'Event',startTime:'2030-01-01T00:00:00Z',endTime:'2030-01-01T01:00:00Z',canceled:false},channelConnections:['forum']}]})).createEventWithChannelConnections[0];
 assert.equal(result.title,'Event');assert.equal(result.description,null);assert.equal(result.Poster,null);
 assert.equal(result.EventChannels[0].channelUniqueName,'forum');assert.equal(result.EventChannels[0].Event.id,result.id);
 assert.deepEqual(result.Tags,[]);assert.deepEqual(result.SubscribedToNotifications,[]);assert.deepEqual(result.SubscribedToEventUpdates,[]);
 assert.equal(result.startTime,'2030-01-01T00:00:00.000Z');assert.equal(typeof result.createdAt,'string');
});
test('event series create and delete occurrence serialize their selected responses',async()=>{
 const source=`mutation($input:CreateEventSeriesInput!){createEventSeriesWithChannelConnections(input:$input){id title description repeatPattern{type count endType endCount} Poster{username} Tags{text} Occurrences{id title startTime endTime canceled occurrenceIndex EventChannels{id channelUniqueName Channel{uniqueName}}} EventChannels{id channelUniqueName Channel{uniqueName}}}}`;
 const series=data(await run(source,{input:{title:'Series',description:null,channelConnections:['forum'],occurrences:[{startTime:'2030-01-01T00:00:00Z',endTime:'2030-01-01T01:00:00Z'}],repeatPattern:{type:'MANUAL',endType:'AFTER_COUNT',endCount:1}}})).createEventSeriesWithChannelConnections;
 assert.equal(series.title,'Series');assert.equal(series.description,'');assert.equal(series.Occurrences.length,1);assert.equal(series.Occurrences[0].occurrenceIndex,0);assert.equal(series.Poster.username,'alice');
 const result=data(await run(`mutation($id:ID!){deleteEventInSeries(eventId:$id,scope:THIS_ONLY){success deletedCount message}}`,{id:series.Occurrences[0].id})).deleteEventInSeries;
 assert.deepEqual(result,{success:true,deletedCount:1,message:'Successfully deleted 1 event(s)'});
 assert.equal((await driver.executeQuery('MATCH(e:Event) RETURN e')).records.length,0);
});
test('discussion update keeps omitted lists, nullable members, and null failures at original boundaries',async()=>{
 await driver.executeQuery("MATCH(a:User {username:'alice'}) CREATE(a)-[:POSTED_DISCUSSION]->(:Discussion {id:'d',title:'Before',createdAt:datetime()})");
 const source=`mutation($connections:[String!],$disconnections:[String],$images:[ID!]){updateDiscussionWithChannelConnections(where:{id:{eq:"d"}},discussionUpdateInput:{title:{set:"After"}},channelConnections:$connections,channelDisconnections:$disconnections,albumImageDisconnections:$images){id title body Author{username} DiscussionChannels{id channelUniqueName} Tags{text} PastTitleVersions{id body createdAt Author{username}} PastBodyVersions{id body createdAt Author{username}} createdAt updatedAt}}`;
 for(const [variables,message] of [
  [{images:null},"Cannot read properties of null (reading 'filter')"],
  [{connections:null},"Cannot read properties of null (reading 'length')"],
  [{disconnections:null},"channelDisconnections is not iterable"],
 ] as const) {
  const result=await run(source,variables);assert.equal(result.data?.updateDiscussionWithChannelConnections,null);
  assert.ok(result.errors?.[0].message.includes(message),result.errors?.[0].message ?? "missing error");
  assert.equal((await driver.executeQuery("MATCH(d:Discussion {id:'d'}) RETURN d.title AS title")).records[0].get('title'),'Before');
 }
 const updated=data(await run(source,{disconnections:[null]})).updateDiscussionWithChannelConnections;
 assert.equal(updated.title,'After');assert.equal(updated.body,null);assert.equal(updated.Author.username,'alice');assert.deepEqual(updated.DiscussionChannels,[]);
 assert.deepEqual(updated.Tags,[]);assert.equal(typeof updated.updatedAt,'string');
});
for (const series of [false,true]) test(`event ${series?'series':'ordinary'} update preserves links for omitted, null and empty lists`,async()=>{
 await driver.executeQuery("MATCH(a:User {username:'alice'}),(c:Channel {uniqueName:'forum'}) CREATE(a)-[:POSTED_BY]->(e:Event {id:'e',title:'Before',startTime:datetime('2030-01-01T00:00:00Z'),endTime:datetime('2030-01-01T01:00:00Z'),canceled:false,createdAt:datetime()}) CREATE(ec:EventChannel {id:'ec',eventId:'e',channelUniqueName:'forum',createdAt:datetime()})-[:POSTED_IN_CHANNEL]->(e) CREATE(ec)-[:POSTED_IN_CHANNEL]->(c)");
 const mutation=series?'updateEventInSeries(eventId:"e",scope:THIS_ONLY,':'updateEventWithChannelConnections(where:{id:{eq:"e"}},';
 const source=`mutation($connections:[String!],$disconnections:[String],$input:EventUpdateInput!){value:${mutation}eventUpdateInput:$input,channelConnections:$connections,channelDisconnections:$disconnections){id title canceled EventChannels{id channelUniqueName} Tags{text}}}`;
 const execute=(variables:Record<string,unknown>)=>graphql({schema:series?schema:secured,source,variableValues:variables,contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:null}}});
 for(const variables of [{},{connections:null,disconnections:null},{connections:[],disconnections:[]}]) {
  const updated=data(await execute({...variables,input:{title:{set:'After'},canceled:{set:true}}})).value;
  assert.equal(updated.title,'After');assert.equal(updated.canceled,true);assert.deepEqual(updated.EventChannels,[{id:'ec',channelUniqueName:'forum'}]);
  assert.equal((await driver.executeQuery("MATCH(:Event {id:'e'})<-[:POSTED_IN_CHANNEL]-(ec:EventChannel) RETURN ec.id AS id")).records[0].get('id'),'ec');
 }
 for(const EventChannels of [null,[]]) {
  assert.deepEqual(data(await execute({input:{EventChannels}})).value.EventChannels,[{id:'ec',channelUniqueName:'forum'}]);
 }
 // The generated v7 relationship operation also supports explicit connect/disconnect.
 const disconnected=data(await execute({input:{EventChannels:[{disconnect:[{where:{node:{id:{eq:'ec'}}}}]}]}})).value;
 assert.deepEqual(disconnected.EventChannels,[]);
 const connected=data(await execute({input:{EventChannels:[{connect:[{where:{node:{id:{eq:'ec'}}}}]}]}})).value;
 assert.deepEqual(connected.EventChannels,[{id:'ec',channelUniqueName:'forum'}]);
 // Named-channel operations retain their existing meaning, including no-op empty lists.
 assert.deepEqual(data(await execute({connections:null,disconnections:['forum'],input:{}})).value.EventChannels,[]);
 assert.deepEqual(data(await execute({connections:['forum'],disconnections:null,input:{}})).value.EventChannels,[{id:'ec',channelUniqueName:'forum'}]);
 if(series){
  const denied=await graphql({schema:secured,source,variableValues:{input:{canceled:{set:false}}},contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:null}}});
  assert.ok(denied.errors,'existing public series restriction must remain');
  assert.equal((await driver.executeQuery("MATCH(e:Event {id:'e'}) RETURN e.canceled AS canceled")).records[0].get('canceled'),true);
 }

});
test('event channel omission does not relax ownership or accept invalid non-channel input',async()=>{
 await driver.executeQuery("MATCH(a:User {username:'alice'}) CREATE(a)-[:POSTED_BY]->(:Event {id:'e',title:'Before',startTime:datetime('2030-01-01T00:00:00Z'),endTime:datetime('2030-01-01T01:00:00Z'),canceled:false,createdAt:datetime()})");
 const source=`mutation($input:EventUpdateInput!){updateEventWithChannelConnections(where:{id:{eq:"e"}},eventUpdateInput:$input){id title}}`;
 for(const username of ['bob',null]) {
  const result=await graphql({schema:secured,source,variableValues:{input:{title:{set:'Denied'}}},contextValue:{driver,req:{headers:{}},user:username?{username,email:null,email_verified:true,data:null}:undefined}});
  assert.ok(result.errors,JSON.stringify(result));
 }
 assert.ok((await run(source,{input:{canceled:{set:'invalid'}}})).errors);
 assert.equal((await driver.executeQuery("MATCH(e:Event {id:'e'}) RETURN e.title AS title")).records[0].get('title'),'Before');
 const result=await graphql({schema:secured,source,variableValues:{input:{title:{set:'Allowed'}}},contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:null}}});
 assert.equal(data(result).updateEventWithChannelConnections.title,'Allowed');
});
test('discussion creation serializes the actual fixed projection and crosspost reuse',async()=>{
 const source=`mutation($input:[DiscussionCreateInputWithChannels!]!){createDiscussionWithChannelConnections(input:$input){id title body Author{username} DiscussionChannels{id createdAt channelUniqueName discussionId archived Flairs{id channelUniqueName displayName color order archived} Channel{uniqueName} Discussion{id} UpvotedByUsers{username}} createdAt updatedAt Tags{text}}}`;
 const input={discussionCreateInput:{title:'Original'},channelConnections:['forum']};
 const original=data(await run(source,{input:[input]})).createDiscussionWithChannelConnections[0];
 assert.equal(original.title,'Original');assert.equal(original.body,null);assert.equal(original.Author.username,'alice');
 assert.equal(original.DiscussionChannels[0].discussionId,original.id);assert.deepEqual(original.Tags,[]);assert.deepEqual(original.DiscussionChannels[0].Flairs,[]);
 const crosspost=data(await run(source,{input:[{...input,discussionCreateInput:{title:'Crosspost'},crosspostedDiscussionId:original.id}]})).createDiscussionWithChannelConnections[0];
 assert.equal(crosspost.title,'Crosspost');assert.equal(crosspost.Author.username,'alice');
 assert.equal((await driver.executeQuery('MATCH(:Discussion)-[r:CROSSPOSTED_DISCUSSION]->() RETURN r')).records.length,1);
});
test('wiki writes serialize selected nullable fields, nested authors/history and Boolean home result',async()=>{
 const source=`mutation($input:WriteWikiPageInput!){writeWikiPage(input:$input){id title body slug channelUniqueName editReason createdAt updatedAt locked OriginalAuthor{username} VersionAuthor{username} Channel{uniqueName} ChildPages{id title slug} PastVersions{id body editReason createdAt Author{username}}}}`;
 const created=data(await run(source,{input:{channelUniqueName:'forum',slug:'home',title:'Home'}})).writeWikiPage;
 assert.equal(created.title,'Home');assert.equal(created.body,null);assert.equal(created.editReason,null);assert.equal(created.locked,false);
 assert.equal(created.Channel.uniqueName,'forum');assert.equal(created.OriginalAuthor.username,'alice');assert.equal(created.VersionAuthor.username,'alice');assert.deepEqual(created.ChildPages,[]);
 assert.equal(created.PastVersions[0].body,'Home');assert.equal(created.PastVersions[0].Author.username,'alice');
 const updated=data(await run(source,{input:{id:created.id,channelUniqueName:'forum',title:'Home',body:'Updated',editReason:'Clarify'}})).writeWikiPage;
 assert.equal(updated.body,'Updated');assert.equal(updated.editReason,'Clarify');assert.equal(typeof updated.updatedAt,'string');
 assert.equal(data(await run('mutation($id:ID!){setWikiHomePage(channelUniqueName:"forum",pageId:$id)}',{id:created.id})).setWikiHomePage,true);
 assert.ok((await run('mutation{setWikiHomePage(channelUniqueName:"forum",pageId:"missing")}')).errors);
 assert.equal((await driver.executeQuery('MATCH(:Channel)-[:HAS_WIKI_HOME_PAGE]->(p) RETURN p.id AS id')).records[0].get('id'),created.id);
});
test('submitted issue serializes numbers, nullable identities, channels and author union',async()=>{
 const source=`mutation($input:SubmitIssueInput!){createIssue(input:$input){id issueNumber title body isOpen channelUniqueName authorName createdAt updatedAt relatedCommentId relatedDiscussionId relatedEventId relatedWikiPageId relatedWikiRevisionId relatedImageId relatedAlbumId relatedUsername relatedModProfileName relatedChannelUniqueName flaggedServerRuleViolation Channel{uniqueName} Author{...on User{username} ...on ModerationProfile{displayName}}}}`;
 const issue=data(await run(source,{input:{title:'Help',body:'Details',channelUniqueName:'forum'}})).createIssue;
 assert.equal(issue.issueNumber,1);assert.equal(issue.isOpen,true);assert.equal(issue.flaggedServerRuleViolation,false);assert.equal(issue.Channel.uniqueName,'forum');assert.equal(issue.Author.username,'alice');
 for(const key of ['relatedCommentId','relatedDiscussionId','relatedEventId','relatedWikiPageId','relatedWikiRevisionId','relatedImageId','relatedAlbumId','relatedUsername','relatedModProfileName','relatedChannelUniqueName']) assert.equal(issue[key],null);
 assert.equal(typeof issue.createdAt,'string');assert.equal(issue.updatedAt,null);
 const generic=data(await run(source,{input:{title:'Server help',body:'Details'}})).createIssue;
 assert.equal(generic.channelUniqueName,null);assert.equal(generic.Channel,null);assert.equal(generic.issueNumber,1);
});
test('discussion missing response rolls back the item before commit',async()=>{
 const repository=createDiscussionCreationRepository(driver);
 let createdId:string|undefined;
 const field=schema.getMutationType()!.getFields().createDiscussionWithChannelConnections;
 const original=field.resolve;
 field.resolve=createDiscussion({driver,discussionCreationRepository:{...repository,findCreatedDiscussion:async (id,tx)=>{
  createdId=id;
  // Remove the item within its transaction; the fixed response guard must roll back.
  assert.ok(tx);
  await tx.run('MATCH(d:Discussion {id:$id}) DETACH DELETE d',{id});
  return repository.findCreatedDiscussion(id,tx);
 }}});
 try {
  const result=await run('mutation{createDiscussionWithChannelConnections(input:[{discussionCreateInput:{title:"Deleted"},channelConnections:["forum"]}]){id title}}');
  assert.equal(result.data,null);assert.deepEqual(result.errors?.[0].path,['createDiscussionWithChannelConnections']);
  assert.match(result.errors?.[0].message ?? '',/Created discussion is unavailable for the response/);assert.equal(typeof createdId,'string');
 } finally {field.resolve=original;}
});
test('event missing transactional response rolls back and omits the failed item',async()=>{
 const repository=createEventWriteRepository(driver);
 let createdId:string|undefined;
 const field=schema.getMutationType()!.getFields().createEventWithChannelConnections;
 const original=field.resolve;
 field.resolve=createEvent({driver,eventWriteRepository:{...repository,findCreatedEvent:async (id,tx)=>{
  createdId=id;
  assert.ok(tx);await tx.run('MATCH(e:Event {id:$id}) DETACH DELETE e',{id});
  return repository.findCreatedEvent(id,tx);
 }}});
 try {
  const result=await run('mutation{createEventWithChannelConnections(input:[{eventCreateInput:{title:"Deleted",startTime:"2030-01-01T00:00:00Z",endTime:"2030-01-01T01:00:00Z",canceled:false},channelConnections:["forum"]}]){id title}}');
  assert.equal(result.errors,undefined);assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{createEventWithChannelConnections:[]});
  assert.equal(typeof createdId,'string');assert.equal((await driver.executeQuery('MATCH(e:Event {id:$id}) RETURN e',{id:createdId})).records.length,0);
 } finally {field.resolve=original;}
});

for(const operation of ['updateDiscussionWithChannelConnections','updateEventWithChannelConnections','updateEventInSeries'] as const) {
 test(`${operation}: fixed response preserves colliding aliases`,async()=>{
  await driver.executeQuery("MATCH(a:User {username:'alice'}) CREATE(a)-[:POSTED_DISCUSSION]->(:Discussion{id:'d',title:'Before',createdAt:datetime()}),(:Event{id:'e',title:'Before',createdAt:datetime(),startTime:datetime('2030-01-01T00:00:00Z'),endTime:datetime('2030-01-01T01:00:00Z'),canceled:false})");
  const args=operation==='updateDiscussionWithChannelConnections'?'where:{id:{eq:"d"}},discussionUpdateInput:{title:{set:"After"}}':operation==='updateEventWithChannelConnections'?'where:{id:{eq:"e"}},eventUpdateInput:{title:{set:"After"}},channelConnections:[],channelDisconnections:[]':'eventId:"e",scope:THIS_ONLY,eventUpdateInput:{title:{set:"After"}}';
  const result=data(await run(`mutation{result:${operation}(${args}){title:id id:title}}`)).result;
  assert.deepEqual(result,{title:operation==='updateDiscussionWithChannelConnections'?'d':'e',id:'After'});
 });
}
test('event series fixed result preserves root and occurrence collisions',async()=>{
 const source='mutation($input:CreateEventSeriesInput!){result:createEventSeriesWithChannelConnections(input:$input){key:id id:title Occurrences{key:id id:title} Poster{name:username}}}';
 const result=data(await run(source,{input:{title:'Series',channelConnections:['forum'],occurrences:[{startTime:'2030-01-01T00:00:00Z',endTime:'2030-01-01T01:00:00Z'}],repeatPattern:{type:'MANUAL',endType:'AFTER_COUNT',endCount:1}}})).result;
 assert.equal(result.id,'Series');assert.equal(result.Occurrences[0].id,'Series');assert.equal(result.Poster.name,'alice');
});
test('wiki fixed response preserves collisions and history author fields',async()=>{
 const result=data(await run('mutation{result:writeWikiPage(input:{channelUniqueName:"forum",slug:"home",title:"Home"}){key:id id:title PastVersions{id:body Author{name:username}}}}')).result;
 assert.equal(result.id,'Home');assert.equal(result.PastVersions[0].id,'Home');assert.equal(result.PastVersions[0].Author.name,'alice');
});
test('owned comment response preserves text/id collision',async()=>{
 const result=data(await run('mutation{result:createCommentWithOwnedConnections(input:[{text:"Hello",isRootComment:true,isFeedbackComment:false}]){rows:comments{key:id id:text}}}')).result;
 assert.equal(result.rows[0].id,'Hello');
});

test('content collision selections cannot bypass anonymous mutation authorization',async()=>{
 await driver.executeQuery("MATCH(ch:Channel {uniqueName:'forum'}) CREATE(dc:DiscussionChannel {id:'dc',channelUniqueName:'forum',discussionId:'target',createdAt:datetime()})-[:POSTED_IN_CHANNEL]->(d:Discussion {id:'target',title:'Target',createdAt:datetime()}) CREATE(dc)-[:POSTED_IN_CHANNEL]->(ch)");
 const operations=[
  'updateDiscussionWithChannelConnections(where:{id:{eq:"missing"}},discussionUpdateInput:{title:{set:"After"}}){id:title}',
  'updateEventWithChannelConnections(where:{id:{eq:"missing"}},eventUpdateInput:{title:{set:"After"}},channelConnections:[],channelDisconnections:[]){id:title}',
  'updateEventInSeries(eventId:"missing",scope:THIS_ONLY,eventUpdateInput:{title:{set:"After"}}){id:title}',
  'writeWikiPage(input:{channelUniqueName:"forum",slug:"home",title:"Home"}){id:title}',
  'createCommentWithOwnedConnections(input:[{text:"Hello",isRootComment:true,isFeedbackComment:false,DiscussionChannel:{connect:{where:{node:{id:"dc"}}}},Channel:{connect:{where:{node:{uniqueName:"forum"}}}},CommentAuthor:{User:{connect:{where:{node:{username:"alice"}}}}}}]){rows:comments{id:text}}',
 ];
 for(const operation of operations){
  const result=await graphql({schema:secured,source:`mutation{result:${operation}}`,contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false}});
  assert.ok(result.errors?.length,operation);assert.match(result.errors[0].message,/logged in|authenticated|Not Authori[sz]ed|permission/i);
 }
 assert.equal((await driver.executeQuery('MATCH(n) WHERE n:Comment OR n:WikiPage RETURN count(n) AS count')).records[0].get('count').toNumber(),0);
});

test('event deletion response preserves colliding success/message fields',async()=>{
 await driver.executeQuery("CREATE(:Event{id:'e',title:'Before',createdAt:datetime(),startTime:datetime('2030-01-01T00:00:00Z'),endTime:datetime('2030-01-01T01:00:00Z'),canceled:false})");
 const result=data(await run('mutation{result:deleteEventInSeries(eventId:"e",scope:THIS_ONLY){success:message message:success count:deletedCount}}')).result;
 assert.deepEqual(result,{success:'Successfully deleted 1 event(s)',message:true,count:1});
});
