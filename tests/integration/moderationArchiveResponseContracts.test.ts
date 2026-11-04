import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema,type GraphQLObjectType} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import permissions from '../../permissions.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {denyExternalHttp} from '../denyExternalHttp.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema,secured:GraphQLSchema,guard:ReturnType<typeof denyExternalHttp>;
let notifications:unknown[]=[];
before(async()=>{driver=await startNeo4j();schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers,features:{filters:{String:{MATCHES:true}}}}).getSchema();registerGeneratedSchema(driver,schema);secured=applyMiddleware(schema,permissions);guard=denyExternalHttp();},{timeout:240000});
after(async()=>{guard?.assertUnused();guard?.restore();await stopNeo4j();});
beforeEach(async()=>{
 await resetDatabase(driver);notifications=[];
 await driver.executeQuery(`CREATE(role:ModChannelRole {name:'fixture-role',canHideEvent:true}),(ch:Channel {uniqueName:'forum',createdAt:datetime()}),(u:User {username:'author',createdAt:datetime()}),
 (m:ModerationProfile {displayName:'mod',createdAt:datetime()}),(c:Comment {id:'c',text:'Comment',isRootComment:true,createdAt:datetime()}),
 (d:Discussion {id:'d',title:'Discussion',createdAt:datetime()}),(dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum',archived:false,createdAt:datetime()}),
 (e:Event {id:'e',title:'Event',createdAt:datetime()}),(ec:EventChannel {id:'ec',eventId:'e',channelUniqueName:'forum',archived:false,createdAt:datetime()}),
 (img:Image {id:'img',url:'https://fixture.invalid/image',scanStatus:'PENDING',createdAt:datetime()}),
 (i:Issue {id:'i',issueNumber:1,title:'Issue',body:'Body',isOpen:true,flaggedServerRuleViolation:false,channelUniqueName:'forum',relatedCommentId:'c',relatedDiscussionId:'d',relatedEventId:'e',relatedImageId:'img',createdAt:datetime()})
 CREATE(ch)-[:HAS_DEFAULT_MOD_ROLE]->(role) CREATE(ch)-[:HAS_COMMENT]->(c) CREATE(dc)-[:CONTAINS_COMMENT]->(c) CREATE(dc)-[:POSTED_IN_CHANNEL]->(d) CREATE(dc)-[:POSTED_IN_CHANNEL]->(ch)
 CREATE(ec)-[:POSTED_IN_CHANNEL]->(e) CREATE(ec)-[:POSTED_IN_CHANNEL]->(ch)
 CREATE(u)-[:AUTHORED_COMMENT]->(c) CREATE(u)-[:POSTED_DISCUSSION]->(d) CREATE(u)-[:POSTED_BY]->(e) CREATE(u)-[:UPLOADED_IMAGE]->(img) CREATE(u)-[:MODERATION_PROFILE]->(m)`);
});
const kinds=[{name:'Comment',args:'commentId:"c"',label:'Comment',id:'c',failureField:'editReason'},
 {name:'Discussion',args:'discussionId:"d",channelUniqueName:"forum"',label:'DiscussionChannel',id:'dc',failureField:'locked'},
 {name:'Event',args:'eventId:"e",channelUniqueName:"forum"',label:'EventChannel',id:'ec',failureField:'locked'},
 {name:'Image',args:'imageId:"img",channelUniqueName:"forum"',label:'Image',id:'img',failureField:'caption'}] as const;
function execute(source:string,authenticated=true,secure=false){return graphql({schema:secure?secured:schema,source:`mutation{${source}}`,contextValue:{driver,req:{headers:{}},user:authenticated?{username:'moderator-user',email:null,email_verified:true,data:{ModerationProfile:{displayName:'mod'}}}:undefined,notificationSnapshotRepository:{findIssueSubscribers:async()=>[],findArchivedAuthor:async()=>[{username:'author',notifyOnContentModeration:true}]},notificationWriter:{createForUser:async(input:unknown)=>{notifications.push(input);return true;}}}});}
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const archive=(kind:typeof kinds[number],selection='id isOpen')=>`archive${kind.name}(${kind.args},selectedForumRules:["rule"],selectedServerRules:[],reportText:"r"){${selection}}`;
const unarchive=(kind:typeof kinds[number],selection='id isOpen')=>`unarchive${kind.name}(${kind.args},explanation:null){${selection}}`;
async function state(kind:typeof kinds[number]){return (await driver.executeQuery(`MATCH(n:${kind.label} {id:$id}) MATCH(i:Issue {id:'i'}) RETURN n.archived AS archived,i.isOpen AS open`,{id:kind.id})).records[0].toObject();}
for(const kind of kinds){
 test(`${kind.name} missing prior issue creates identity then returns closed state`,async()=>{
  await driver.executeQuery("MATCH(i:Issue) DETACH DELETE i");
  const result=await execute(archive(kind));assert.equal(result.errors,undefined);
  const row=plain(result.data)[`archive${kind.name}`];assert.ok(row.id);assert.equal(row.isOpen,false);
  const stored=(await driver.executeQuery("MATCH(i:Issue {id:$id}) RETURN i.isOpen AS open",{id:row.id})).records[0];assert.equal(stored.get('open'),false);assert.equal(notifications.length,1);
 });
 test(`${kind.name} archive/rearchive/unarchive return final closed issue and preserve notifications`,async()=>{
  for(const source of [archive(kind),archive(kind),unarchive(kind)]){const result=await execute(source);assert.equal(result.errors,undefined);assert.deepEqual(Object.values(plain(result.data))[0],{id:'i',isOpen:false});}
  assert.deepEqual(await state(kind),{archived:false,open:false});assert.equal(notifications.length,2);
 });
 test(`${kind.name} persisted body stays lazy and malformed selected output fails after content update`,async()=>{
  await driver.executeQuery("MATCH(i:Issue) SET i.body=['bad']");assert.equal((await execute(archive(kind))).errors,undefined);
  const result=await execute(unarchive(kind,'id isOpen body'));assert.match(result.errors?.[0].message??'',/String cannot represent/);assert.deepEqual(result.errors?.[0].path,[`unarchive${kind.name}`,'body']);assert.deepEqual(await state(kind),{archived:false,open:false});
 });
 test(`${kind.name} content projection failure preserves committed close/archive and earlier effects`,async()=>{
  const field=(schema.getType(kind.label) as GraphQLObjectType).getFields()[kind.failureField],original=field.resolve;
  field.resolve=()=>{throw Error('injected content projection failure');};
  try{const result=await execute(archive(kind));assert.ok(result.errors);assert.deepEqual(await state(kind),{archived:true,open:false});assert.equal(notifications.length,0);}finally{field.resolve=original;}
 });
 test(`${kind.name} missing issue and anonymous requests fail before archive changes`,async()=>{
  assert.ok((await execute(archive(kind),false,true)).errors);
  await driver.executeQuery("MATCH(i:Issue) DETACH DELETE i");assert.match((await execute(unarchive(kind))).errors?.[0].message??'',/Issue not found/);assert.equal(notifications.length,0);
 });
}
test('server-scoped image archive preserves nullable scope and closed state',async()=>{
 await driver.executeQuery("MATCH(i:Issue) REMOVE i.channelUniqueName");
 const result=await execute('archiveImage(imageId:"img",channelUniqueName:null,selectedForumRules:[],selectedServerRules:["r"],reportText:"r"){id isOpen channelUniqueName}');
 assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data),{archiveImage:{id:'i',isOpen:false,channelUniqueName:null}});
});

test('event moderator permission denial leaves issue and event state unchanged',async()=>{
 await driver.executeQuery("MATCH(r:ModChannelRole) SET r.canHideEvent=false");
 const result=await execute(archive(kinds[2]));assert.ok(result.errors);assert.deepEqual(await state(kinds[2]),{archived:false,open:true});assert.equal(notifications.length,0);
});
