import {getSiteWideDiscussionsQuery} from "../../customResolvers/cypher/cypherQueries.js";
import {siteWideDownloadFileSelection} from "../../customResolvers/contracts/siteWideDownloadFiles.js";
import {discussionListFlairSelection} from "../../customResolvers/contracts/discussionListFlairs.js";
import type {SiteWideDiscussionSource} from "../../customResolvers/contracts/siteWideDiscussionSources.js";
import identityMiddleware from "../../middleware/userChildIdentityMiddleware.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let schema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neo = new Neo4jGraphQL({ driver, typeDefs, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  const generated = await neo.getSchema();
  registerGeneratedSchema(driver, generated);
  schema = applyMiddleware(generated, identityMiddleware, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (ch:Channel {uniqueName:'cats', displayName:'Cats'})
    CREATE (u:User {username:'alice',createdAt:datetime(),discussionKarma:0,commentKarma:0})
    CREATE (d:Discussion {id:'d1',title:'Visible discussion',body:'Hello',createdAt:datetime(),hasSensitiveContent:false})
    CREATE (dc:DiscussionChannel {id:'dc1',discussionId:'d1',channelUniqueName:'cats',createdAt:datetime(),weightedVotesCount:1})
    CREATE (u)-[:POSTED_DISCUSSION]->(d), (u)-[:UPVOTED_DISCUSSION]->(dc)
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(d), (dc)-[:POSTED_IN_CHANNEL]->(ch)
    CREATE (dc)-[:CONTAINS_COMMENT]->(:Comment {id:'normal',isFeedbackComment:false})
    CREATE (dc)-[:CONTAINS_COMMENT]->(:Comment {id:'legacy'})
    CREATE (dc)-[:CONTAINS_COMMENT]->(feedback:Comment {id:'feedback',isFeedbackComment:true})
    CREATE (feedback)-[:HAS_FEEDBACK_COMMENT]->(d)
  `);
});
const execute = (source: string, variableValues = {}, mayAccessSensitiveContent?: boolean) => graphql({ schema, source, variableValues,
  contextValue: { driver, mayAccessSensitiveContent, req: { headers: {}, body: {} } } });
// Preserve the bounded custom resolver's count semantics: legacy comments with
// no isFeedbackComment flag count as normal comments, including in detail.
const listQuery = readFileSync(new URL('../fixtures/siteWideDiscussionList.graphql', import.meta.url), 'utf8');
const variables = { searchInput:'', selectedChannels:[], selectedTags:[], showArchived:false, options:{sort:'new',limit:10} };

test('nonempty site-wide list resolves the actual frontend connection selection', async () => {
  const minimal = await execute('{ getSiteWideDiscussionList(showArchived:false, options:{sort:new}) { discussions { id } } }');
  assert.equal(minimal.errors, undefined);
  assert.equal((minimal.data as any).getSiteWideDiscussionList.discussions[0].id, 'd1');
  const result = await execute(listQuery, variables);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const list = (result.data as any).getSiteWideDiscussionList;
  assert.equal(list.aggregateDiscussionCount, 1);
  assert.equal(list.discussions[0].DiscussionChannels[0].CommentsConnection.aggregate.count.nodes, 2);
});

test('zero comments and excluded discussions retain the empty and visibility behavior', async () => {
  await driver.executeQuery('MATCH (c:Comment) DETACH DELETE c');
  const result = await execute(listQuery, variables);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.equal((result.data as any).getSiteWideDiscussionList.discussions[0].DiscussionChannels[0].CommentsConnection.aggregate.count.nodes, 0);
  await driver.executeQuery('MATCH (dc:DiscussionChannel) SET dc.archived = true');
  const hidden = await execute(listQuery, variables);
  assert.equal(hidden.errors, undefined);
  assert.deepEqual((hidden.data as any).getSiteWideDiscussionList.discussions, []);
});

test('discussion and download detail connection counts survive GraphQL serialization', async () => {
  const result = await execute(`{ getDiscussionDetail(discussionId:"d1",channelUniqueName:"cats") {
    id FeedbackCommentsConnection { aggregate { count { nodes } } }
    DiscussionChannels { id
      CommentsConnection(where:{node:{isFeedbackComment:{eq:false}}}) { aggregate { count { nodes } } }
      UpvotedByUsersConnection { aggregate { count { nodes } } }
    }
  } }`);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const detail = (result.data as any).getDiscussionDetail[0];
  assert.equal(detail.FeedbackCommentsConnection.aggregate.count.nodes, 1);
  assert.equal(detail.DiscussionChannels[0].CommentsConnection.aggregate.count.nodes, 2);
  assert.equal(detail.DiscussionChannels[0].UpvotedByUsersConnection.aggregate.count.nodes, 1);
});


test('sensitive discussions remain hidden from ineligible readers', async () => {
  await driver.executeQuery('MATCH (d:Discussion) SET d.hasSensitiveContent = true');
  const list = await execute(listQuery, variables, false);
  assert.equal(list.errors, undefined, JSON.stringify(list.errors));
  assert.deepEqual((list.data as any).getSiteWideDiscussionList.discussions, []);
  const detail = await execute('{ getDiscussionDetail(discussionId:"d1",channelUniqueName:"cats") { id } }', {}, false);
  assert.equal(detail.errors, undefined, JSON.stringify(detail.errors));
  assert.deepEqual((detail.data as any).getDiscussionDetail, []);
});

test('channel lists retain their explicit aggregate contract', async () => {
  const result = await execute(`{ getDiscussionsInChannel(channelUniqueName:"cats",showArchived:false,options:{sort:new}) {
    discussionChannels { id CommentsAggregate { count } UpvotedByUsersAggregate { count } }
  } }`);
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  const channel = (result.data as any).getDiscussionsInChannel.discussionChannels[0];
  assert.equal(channel.CommentsAggregate.count, 2);
  assert.equal(channel.UpvotedByUsersAggregate.count, 1);
});

const sitewide = (fields:string) => `{result:getSiteWideDiscussionList(showArchived:false,options:{sort:new}){discussions{${fields}}}}`;
test('sitewide file list aliases cannot read the sibling tag collection',async()=>{
  await driver.executeQuery(`MATCH(d:Discussion{id:'d1'}) CREATE(d)-[:HAS_TAG]->(:Tag{text:'tag'}),
    (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile{id:'file',scanStatus:'CLEAN'})`);
  const result=await execute(sitewide('Tags:DownloadableFiles {id}'));
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)).result.discussions,[{Tags:[{id:'file'}]}]);
});
test('sitewide author aliases retain their own canonical properties',async()=>{
  await driver.executeQuery("MATCH(u:User) SET u.displayName='Alice display'");
  const result=await execute(sitewide('Author {displayName:username username:displayName}'));
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)).result.discussions,[{Author:{displayName:'alice',username:'Alice display'}}]);
});
test('sitewide owned connection aliases retain count containers',async()=>{
  const result=await execute(sitewide('DiscussionChannels {CommentsConnection {aggregate:totalCount totalCount:aggregate {count {nodes}}}}'));
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)).result.discussions,[{DiscussionChannels:[{CommentsConnection:{aggregate:2,totalCount:{count:{nodes:2}}}}]}]);
});

async function seedSitewideChildren(){
 await driver.executeQuery(`MATCH(d:Discussion{id:'d1'}),(dc:DiscussionChannel{id:'dc1'}),(ch:Channel),(u:User)
  SET u.displayName='Alice display'
  CREATE(d)-[:HAS_TAG]->(:Tag{text:'tag'}),
   (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile{id:'file',scanStatus:'CLEAN'}),
   (d)-[:HAS_ALBUM]->(a:Album{id:'album',imageOrder:['image']}),
   (a)-[:HAS_IMAGE]->(:Image{id:'image',url:'https://image.invalid',alt:'Alternative',caption:'Caption'}),
   (dc)-[:HAS_DISCUSSION_FLAIR]->(f:DiscussionFlair{id:'flair',displayName:'Category',color:'blue',order:1,archived:false}),
   (ch)-[:HAS_DISCUSSION_FLAIR]->(f),(u)-[:SUPER_UPVOTED_DISCUSSION]->(dc)`);
}
function exactKeys<T extends object>(value:T,keys:Record<keyof T,true>){assert.deepEqual(Object.keys(value).sort(),Object.keys(keys).sort());}
test('actual sitewide hydration retains every declared nested map key',async()=>{
 await seedSitewideChildren();
 const session=driver.session();
 const result=await session.run<{discussion:SiteWideDiscussionSource}>(getSiteWideDiscussionsQuery,
  {discussionIds:['d1'],selectedChannels:[],showArchived:false,loggedInUsername:null,mayAccessSensitiveContent:false}).finally(()=>session.close());
 const d=result.records[0]!.get('discussion');
 exactKeys(d,{id:true,title:true,body:true,createdAt:true,updatedAt:true,hasSensitiveContent:true,hasSpoiler:true,
  Author:true,DiscussionChannels:true,Tags:true,Album:true,DownloadableFiles:true,isFavorited:true});
 assert.ok(d.Author);exactKeys(d.Author,{username:true,displayName:true,profilePicURL:true,createdAt:true,discussionKarma:true,commentKarma:true});
 assert.ok(d.Album);exactKeys(d.Album,{id:true,imageOrder:true,Images:true});
 assert.equal(d.Album.Images.length,1);exactKeys(d.Album.Images[0]!,{id:true,url:true,alt:true,caption:true,archived:true,permanentlyRemoved:true});
 assert.equal(d.Tags.length,1);exactKeys(d.Tags[0]!,{text:true});
 assert.equal(d.DownloadableFiles.length,1);exactKeys(d.DownloadableFiles[0]!,siteWideDownloadFileSelection);
 assert.equal(d.DiscussionChannels.length,1);const c=d.DiscussionChannels[0]!;
 exactKeys(c,{id:true,createdAt:true,channelUniqueName:true,discussionId:true,weightedVotesCount:true,archived:true,
  answered:true,locked:true,Flairs:true,Channel:true,UpvotedByUsers:true,SuperUpvotedByUsers:true,CommentsConnection:true});
 exactKeys(c.Channel,{uniqueName:true,displayName:true,channelIconURL:true});
 assert.equal(c.Flairs.length,1);exactKeys(c.Flairs[0]!,discussionListFlairSelection);
 for(const users of [c.UpvotedByUsers,c.SuperUpvotedByUsers]){assert.equal(users.length,1);exactKeys(users[0]!,{username:true});}
 exactKeys(c.CommentsConnection,{totalCount:true,aggregate:true});exactKeys(c.CommentsConnection.aggregate,{count:true});
 exactKeys(c.CommentsConnection.aggregate.count,{nodes:true});
});
test('sitewide nested owned maps preserve fragments, aliases and skipped fields',async()=>{
 await seedSitewideChildren();
 const result=await execute(`query($skip:Boolean!){result:getSiteWideDiscussionList(showArchived:false,options:{sort:new}){discussions{...Parts}}}
 fragment Parts on SiteWideDiscussionListItem {
  title:body body:title DownloadableFiles {scanStatus:id id:scanStatus}
  Album {imageOrder:Images {alt:caption caption:alt}}
  DiscussionChannels {Flairs {color:displayName displayName:color} Channel {displayName:uniqueName uniqueName:displayName}}
  skipped:Author @skip(if:$skip){username}
 }`,{skip:true});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)).result.discussions,[{
  title:'Hello',body:'Visible discussion',DownloadableFiles:[{scanStatus:'file',id:'CLEAN'}],
  Album:{imageOrder:[{alt:'Caption',caption:'Alternative'}]},
  DiscussionChannels:[{Flairs:[{color:'Category',displayName:'blue'}],Channel:{displayName:'cats',uniqueName:'Cats'}}]
 }]);
});
test('sitewide raw file enum values fail only when requested with the correct alias path',async()=>{
 await seedSitewideChildren();await driver.executeQuery("MATCH(f:DownloadableFile) SET f.scanStatus='INVALID'");
 assert.equal((await execute(sitewide('DownloadableFiles{id}'))).errors,undefined);
 const selected=await execute(sitewide('files:DownloadableFiles{state:scanStatus}'));
 assert.match(selected.errors?.[0].message??'',/ScanStatus/);
 assert.deepEqual(selected.errors?.[0].path,['result','discussions',0,'files',0,'state']);
});
for(const viewer of ['alice','other',null]) test(`sitewide author private child retains ${viewer??'anonymous'} permission under aliases`,async()=>{
 await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.displayName='Alice display' CREATE(:Email{address:'alice@sitewide.test'})-[:HAS_EMAIL]->(u)");
 const result=await graphql({schema,source:sitewide('Author{username:displayName mail:Email{address}}'),contextValue:{driver,req:{headers:{},body:{}},mayAccessSensitiveContent:false,user:viewer?{username:viewer,email:null,email_verified:true,data:null}:null}});
 if(viewer==='alice'){
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  // This fixed projection does not hydrate Email; authorized absence is still null.
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)).result.discussions,[{Author:{username:'Alice display',mail:null}}]);
 }else{
  assert.ok(result.errors?.some(error=>error.path?.join('.')==='result.discussions.0.Author.mail'));
  assert.equal(JSON.parse(JSON.stringify(result.data)).result.discussions[0].Author.mail,null);
 }
});
