import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema,type GraphQLObjectType} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import permissions from '../../permissions.js';
import issueIdentityMiddleware from '../../middleware/issueIdentityMiddleware.js';
import {registerGeneratedSchema,getGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver, schema:GraphQLSchema;
before(async()=>{
 driver=await startNeo4j();
 const app=new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers,features:{filters:{String:{MATCHES:true}}}});
 const raw=await app.getSchema();registerGeneratedSchema(driver,raw);
 schema=applyMiddleware(raw,permissions,issueIdentityMiddleware as never);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 await resetDatabase(driver);
 await driver.executeQuery(`CREATE (alice:User {username:'alice',createdAt:datetime()}),(bob:User {username:'bob',createdAt:datetime()}),
   (c:Channel {uniqueName:'forum',wikiEnabled:true,imageUploadsEnabled:true}), (other:Channel {uniqueName:'other',wikiEnabled:true}),
   (d:Discussion {id:'d',title:'Original',createdAt:datetime()}),
   (own:Image {id:'own',url:'own.jpg',createdAt:datetime()}),(reused:Image {id:'reused',url:'reuse.jpg',createdAt:datetime()})
   CREATE (alice)-[:ADMIN_OF_CHANNEL]->(c) CREATE (alice)-[:ADMIN_OF_CHANNEL]->(other)
   CREATE (alice)-[:POSTED_DISCUSSION]->(d)
   CREATE (alice)-[:UPLOADED_IMAGE]->(own) CREATE (bob)-[:UPLOADED_IMAGE]->(reused)
   CREATE (dc:DiscussionChannel {id:'dc',channelUniqueName:'forum',discussionId:'d',createdAt:datetime()})-[:POSTED_IN_CHANNEL]->(d) CREATE(dc)-[:POSTED_IN_CHANNEL]->(c)`);
});
const run=(source:string,variables:Record<string,unknown>,username='alice')=>graphql({schema,source,variableValues:variables,contextValue:{driver,req:{headers:{}},user:{username,email:null,email_verified:true,data:null},mayAccessSensitiveContent:false}});
const ok=(r:Awaited<ReturnType<typeof run>>)=>{assert.equal(r.errors,undefined,JSON.stringify(r.errors));return r.data as any;};
const ISSUE=`mutation($input:SubmitIssueInput!){createIssue(input:$input){id issueNumber channelUniqueName authorName title createdAt updatedAt relatedDiscussionId Author{... on User{username} ... on ModerationProfile{displayName}} Channel{uniqueName}}}`;
test('generic forum/server requests have authenticated authors and independent server numbers',async()=>{
 const forum=ok(await run(ISSUE,{input:{title:'Help',body:'Details',channelUniqueName:'forum'}})).createIssue;
 const server=ok(await run(ISSUE,{input:{title:'Help server',body:'Details'}})).createIssue;
 assert.equal(forum.issueNumber,1);assert.equal(forum.channelUniqueName,'forum');assert.equal(forum.authorName,'alice');assert.equal(forum.title,'Help');
 assert.equal(server.issueNumber,1);assert.equal(server.channelUniqueName,null);
 assert.equal((await run(ISSUE,{input:{title:'No',body:'No',issueNumber:99}})).errors?.length,1);
});
test('missing/conflicting targets and invalid identity cannot consume numbers or leave partial issues',async()=>{
 for(const extra of [{relatedDiscussionId:'missing'},{relatedDiscussionId:'d',relatedImageId:'own'},{asModerationProfile:true}]){
  assert.ok((await run(ISSUE,{input:{title:'No',body:'No',...extra}})).errors);
 }
 assert.equal((await driver.executeQuery('MATCH(i:Issue) RETURN i')).records.length,0);
 assert.equal((await driver.executeQuery('MATCH(c:ChannelIssueCounter) RETURN c')).records.length,0);
});
const ALBUM=`mutation($album:DiscussionAlbumInput){updateDiscussionWithChannelConnections(where:{id:{eq:"d"}},discussionUpdateInput:{},album:$album){id}}`;
test('album IDs preserve reuse ownership, authorize metadata, distinguish omitted and empty membership',async()=>{
 ok(await run(ALBUM,{album:{imageIds:['own','reused'],imageUpdates:[{id:'own',caption:'Mine'}]}}));
 const before=(await driver.executeQuery(`MATCH (u:User)-[:UPLOADED_IMAGE]->(i:Image {id:'reused'}) RETURN u.username AS name`)).records;
 assert.deepEqual(before.map(r=>r.get('name')),['bob']);
 assert.ok((await run(ALBUM,{album:{imageIds:['own','reused'],imageUpdates:[{id:'reused',caption:'Stolen'}]}})).errors);
 assert.ok((await run(ALBUM,{album:{imageIds:['missing']}})).errors);
 ok(await run(ALBUM,{}));
 assert.equal((await driver.executeQuery('MATCH(:Discussion {id:"d"})-[:HAS_ALBUM]->(:Album)-[:HAS_IMAGE]->(i) RETURN i')).records.length,2);
 ok(await run(ALBUM,{album:{imageIds:[]}}));
 assert.equal((await driver.executeQuery('MATCH(:Discussion {id:"d"})-[:HAS_ALBUM]->(:Album)-[:HAS_IMAGE]->(i) RETURN i')).records.length,0);
});
test('album editing retains the discussion permission gate',async()=>{
 assert.ok((await run(ALBUM,{album:{imageIds:['reused']}},'bob')).errors);
 assert.equal((await driver.executeQuery('MATCH(a:Album) RETURN a')).records.length,0);
});
const WIKI=`mutation($input:WriteWikiPageInput!){writeWikiPage(input:$input){id title body slug VersionAuthor{username} OriginalAuthor{username} PastVersions{body Author{username}}}}`;
test('wiki home, child, update and revision author relationships commit together',async()=>{
 const home=ok(await run(WIKI,{input:{channelUniqueName:'forum',slug:'home',title:'Home',body:'Original',setAsHome:true}})).writeWikiPage;
 assert.equal(home.VersionAuthor.username,'alice');
 const child=ok(await run(WIKI,{input:{channelUniqueName:'forum',slug:'child',title:'Child',parentId:home.id}})).writeWikiPage;
 assert.ok((await run(WIKI,{input:{channelUniqueName:'other',slug:'wrong',title:'Wrong',parentId:home.id}})).errors);
 await driver.executeQuery(`MATCH (u:User {username:'bob'}),(c:Channel {uniqueName:'forum'}) CREATE (u)-[:ADMIN_OF_CHANNEL]->(c)`);
 const updated=ok(await run(WIKI,{input:{id:home.id,channelUniqueName:'forum',title:'Home',body:'Edited'}},'bob')).writeWikiPage;
 assert.equal(updated.OriginalAuthor.username,'alice');assert.equal(updated.VersionAuthor.username,'bob');
 assert.deepEqual(updated.PastVersions.map((v:any)=>[v.body,v.Author.username]),[['Original','alice']]);
 ok(await run(`mutation($id:ID!){setWikiHomePage(channelUniqueName:"forum",pageId:$id)}`,{id:child.id}));
 assert.equal((await driver.executeQuery('MATCH(:Channel {uniqueName:"forum"})-[:HAS_WIKI_HOME_PAGE]->(p) RETURN p.id AS id')).records[0].get('id'),child.id);
});
test('wiki editing rejects unauthorized actors and spoofed author inputs',async()=>{
 assert.ok((await run(WIKI,{input:{channelUniqueName:'forum',slug:'x',title:'No'}},'bob')).errors);
 assert.ok((await run(WIKI,{input:{channelUniqueName:'forum',slug:'x',title:'No',VersionAuthor:{username:'bob'}}})).errors);
 assert.equal((await driver.executeQuery('MATCH(p:WikiPage) RETURN p')).records.length,0);
});
const CROSSPOST=`mutation($input:[DiscussionCreateInputWithChannels!]!){createDiscussionWithChannelConnections(input:$input){id title}}`;
test('existing crosspost reference does not duplicate the source and rejects missing/hidden sources',async()=>{
 const input={discussionCreateInput:{title:'Crosspost'},channelConnections:['forum'],crosspostedDiscussionId:'d'};
 const created=ok(await run(CROSSPOST,{input:[input]})).createDiscussionWithChannelConnections[0];
 const edge=await driver.executeQuery('MATCH(:Discussion {id:$id})-[:CROSSPOSTED_DISCUSSION]->(d) RETURN d.id AS id',{id:created.id});
 assert.equal(edge.records[0].get('id'),'d');
 assert.equal((await driver.executeQuery('MATCH(d:Discussion) RETURN d')).records.length,2);
 assert.ok((await run(CROSSPOST,{input:[{...input,crosspostedDiscussionId:'missing'}]})).errors);
 await driver.executeQuery('MATCH(d:Discussion {id:"d"}) SET d.hasSensitiveContent=true');
 assert.ok((await run(CROSSPOST,{input:[input]})).errors);
 assert.equal((await driver.executeQuery('MATCH(d:Discussion) RETURN d')).records.length,2);
});
test('failed album writes roll back scalar edits and metadata edits made earlier in the transaction',async()=>{
 const source=`mutation($album:DiscussionAlbumInput){updateDiscussionWithChannelConnections(where:{id:{eq:"d"}},discussionUpdateInput:{title:{set:"Changed"}},album:$album){id}}`;
 assert.ok((await run(source,{album:{imageIds:['own','reused'],imageUpdates:[{id:'own',caption:'Should roll back'},{id:'reused',caption:'Denied'}]}})).errors);
 const row=(await driver.executeQuery('MATCH(d:Discussion {id:"d"}),(i:Image {id:"own"}) RETURN d.title AS title,i.caption AS caption')).records[0];
 assert.equal(row.get('title'),'Original');assert.equal(row.get('caption'),null);
});
test('album membership validates image policy and does not assign uploader to reused images on inline creation',async()=>{
 await driver.executeQuery('MATCH(c:Channel {uniqueName:"forum"}) SET c.imageUploadsEnabled=false');
 assert.ok((await run(ALBUM,{album:{imageIds:['own']}})).errors);
 await driver.executeQuery('MATCH(c:Channel {uniqueName:"forum"}) SET c.imageUploadsEnabled=true');
 const input={discussionCreateInput:{title:'Inline album',Album:{create:{node:{imageOrder:['reused'],Images:{connect:[{where:{node:{id:{eq:'reused'}}}}]}}}}},channelConnections:['forum']};
 ok(await run(CROSSPOST,{input:[input]}));
 const owners=await driver.executeQuery('MATCH(u:User)-[:UPLOADED_IMAGE]->(:Image {id:"reused"}) RETURN u.username AS username');
 assert.deepEqual(owners.records.map(r=>r.get('username')),['bob']);
});
test('issue author persona is authenticated and server numbering shares the existing server counter',async()=>{
 await driver.executeQuery(`MATCH(u:User {username:'alice'}) CREATE(u)-[:HAS_MODERATION_PROFILE]->(:ModerationProfile {displayName:'mod'}) CREATE(:ServerIssueCounter {scope:'server',current:8})`);
 const r=await graphql({schema,source:ISSUE,variableValues:{input:{title:'Staff request',body:'Details',asModerationProfile:true}},contextValue:{driver,req:{headers:{}},user:{username:'alice',email:null,email_verified:true,data:{ModerationProfile:{displayName:'mod'}}},mayAccessSensitiveContent:false}});
 const issue=ok(r).createIssue;assert.equal(issue.authorName,'mod');assert.equal(issue.issueNumber,9);
});
test('all application write contracts reject anonymous callers',async()=>{
 const requests=[{source:ISSUE,vars:{input:{title:'Help',body:'Details'}}},{source:ALBUM,vars:{album:{imageIds:[]}}},{source:WIKI,vars:{input:{channelUniqueName:'forum',slug:'x',title:'No'}}},{source:CROSSPOST,vars:{input:[{discussionCreateInput:{title:'No'},channelConnections:['forum'],crosspostedDiscussionId:'d'}]}}];
 for(const request of requests) assert.ok((await run(request.source,request.vars,'')).errors);
});
test('wiki home reassignment cannot cross channels and locked pages retain the moderation gate',async()=>{
 const page=ok(await run(WIKI,{input:{channelUniqueName:'forum',slug:'page',title:'Page'}})).writeWikiPage;
 assert.ok((await run(`mutation($id:ID!){setWikiHomePage(channelUniqueName:"other",pageId:$id)}`,{id:page.id})).errors);
 await driver.executeQuery('MATCH(p:WikiPage {id:$id}) SET p.locked=true',{id:page.id});
 assert.ok((await run(WIKI,{input:{id:page.id,channelUniqueName:'forum',title:'Denied'}})).errors);
});
test('issue content targets must belong to their scope and cannot name a different author',async()=>{
 ok(await run(ISSUE,{input:{title:'Report',body:'Details',channelUniqueName:'forum',relatedDiscussionId:'d'}}));
 assert.ok((await run(ISSUE,{input:{title:'No',body:'No',channelUniqueName:'other',relatedDiscussionId:'d'}})).errors);
 assert.ok((await run(ISSUE,{input:{title:'No',body:'No',relatedDiscussionId:'d',relatedUsername:'bob'}})).errors);
 assert.equal((await driver.executeQuery('MATCH(i:Issue) RETURN i')).records.length,1);
});
test('issue response failure rolls back the issue, its identity and its number',async()=>{
 const fields=(getGeneratedSchema(driver).getType('Issue') as GraphQLObjectType).getFields();
 const original=fields.createdAt.resolve;
 fields.createdAt.resolve=()=>{throw new Error('Injected issue read failure');};
 try {
  assert.ok((await run(ISSUE,{input:{title:'Help',body:'Details'}})).errors);
 } finally {fields.createdAt.resolve=original;}
 assert.equal((await driver.executeQuery('MATCH(i:Issue) RETURN i')).records.length,0);
 assert.equal((await driver.executeQuery('MATCH(c:ServerIssueCounter) RETURN c')).records.length,0);
});
test('crosspost creation rejects unauthorized actors and empty references without writes',async()=>{
 const input={discussionCreateInput:{title:'No'},channelConnections:['forum'],crosspostedDiscussionId:'d'};
 assert.ok((await run(CROSSPOST,{input:[input]},'bob')).errors);
 assert.ok((await run(CROSSPOST,{input:[{...input,crosspostedDiscussionId:''}]})).errors);
 assert.equal((await driver.executeQuery('MATCH(d:Discussion) RETURN d')).records.length,1);
});
test('wiki update with missing historical author rolls back and preserves its original content',async()=>{
 const page=ok(await run(WIKI,{input:{channelUniqueName:'forum',slug:'legacy',title:'Legacy',body:'Before'}})).writeWikiPage;
 await driver.executeQuery('MATCH(:User)-[r:AUTHORED_VERSION]->(:WikiPage {id:$id}) DELETE r',{id:page.id});
 assert.ok((await run(WIKI,{input:{id:page.id,channelUniqueName:'forum',title:'Changed',body:'After'}})).errors);
 const row=(await driver.executeQuery('MATCH(p:WikiPage {id:$id}) RETURN p.title AS title,p.body AS body',{id:page.id})).records[0];
 assert.equal(row.get('title'),'Legacy');assert.equal(row.get('body'),'Before');
});
