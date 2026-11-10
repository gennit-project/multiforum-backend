import { getDiscussionChannelsQuery } from "../../customResolvers/cypher/cypherQueries.js";
import type { DiscussionListViewerChannel } from "../../customResolvers/contracts/viewerReadProjections.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import identityMiddleware from "../../middleware/userChildIdentityMiddleware.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
  secured = applyMiddleware(schema, identityMiddleware, permissions);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => resetDatabase(driver));
function execute(source: string, username: string | null = "actor", protect = false) {
  return graphql({ schema: protect ? secured : schema, source,
    contextValue: { driver, req: { headers: {} }, mayAccessSensitiveContent: false, user: username ? { username, email:null, email_verified:true, data:null } : undefined } });
}
function data(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined);
  return JSON.parse(JSON.stringify(result.data));
}

const viewerFields = 'id isFavoritedByUser SubscribedToNotifications { username }';
const queries = {
  replies: `{result:getCommentReplies(commentId:"parent",modName:"",sort:new,limit:2) { aggregateChildCommentCount ChildComments { ${viewerFields} ParentComment { id } } }}`,
  section: `{result:getCommentSection(discussionId:"d",channelUniqueName:"forum",modName:"",sort:"new",limit:2) { DiscussionChannel { discussionId channelUniqueName SubscribedToNotifications {username} Channel {uniqueName} Discussion {id} } Comments { ${viewerFields} } }}`,
  event: `{result:getEventComments(eventId:"event",sort:new,limit:2) { Event {id SubscribedToNotifications {username} SubscribedToEventUpdates {username}} Comments { ${viewerFields} } }}`,
  detail: '{result:getDiscussionDetail(discussionId:"d",channelUniqueName:"forum") {id isFavorited DiscussionChannels {discussionId channelUniqueName UpvotedByUsers {username} SuperUpvotedByUsers {username}}}}',
  list: '{result:getDiscussionsInChannel(channelUniqueName:"forum",showArchived:false,options:{sort:new,limit:2}) {discussionChannels {UpvotedByUsers {username} SuperUpvotedByUsers {username} isFavorited Discussion {authorIsChannelModerator}}}}',
  channels: '{result:getSortedChannels(countDownloads:false,limit:2) {channels {isFavorited}}}',
};
async function seed() {
  await driver.executeQuery(`CREATE (actor:User {username:'actor'}),(other:User {username:'other'}),
    (ch:Channel {uniqueName:'forum'}),(d:Discussion {id:'d',createdAt:datetime('2026-01-01'),hasDownload:false}),
    (dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum',createdAt:datetime('2026-01-01'),archived:false}),
    (event:Event {id:'event'}),(parent:Comment {id:'parent',createdAt:datetime('2026-01-01')})
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(d),(dc)-[:POSTED_IN_CHANNEL]->(ch),(dc)-[:CONTAINS_COMMENT]->(parent)
    FOREACH (user IN [actor,other] |
      CREATE (user)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc),(user)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(event),
        (user)-[:SUBSCRIBED_TO_EVENT_UPDATES]->(event),(user)-[:UPVOTED_DISCUSSION]->(dc),
        (user)-[:SUPER_UPVOTED_DISCUSSION]->(dc),(user)-[:DEFAULT_FAVORITES_DISCUSSIONS]->(d),
        (user)-[:DEFAULT_FAVORITES_CHANNELS]->(ch))
    WITH actor,other,dc,event,parent UNWIND range(1,3) AS n
    CREATE (c:Comment {id:'c'+toString(n),text:'comment',isRootComment:true,createdAt:datetime('2026-01-0'+toString(n)),archived:n=3}),
      (r:Comment {id:'r'+toString(n),text:'reply',isRootComment:false,createdAt:datetime('2026-01-0'+toString(n)),archived:n=3})
    CREATE (dc)-[:CONTAINS_COMMENT]->(c),(event)-[:HAS_COMMENT]->(c),(r)-[:IS_REPLY_TO]->(parent)
    FOREACH (user IN [actor,other] | CREATE (user)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(c),
      (user)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(r),(user)-[:DEFAULT_FAVORITES_COMMENTS]->(c),(user)-[:DEFAULT_FAVORITES_COMMENTS]->(r))`);
}
for(const kind of ['replies','section','event'] as const) {
  test(`${kind}: viewer state excludes other identities and respects ordered page limit`,async()=>{
    await seed();const result=data(await execute(queries[kind])).result;
    const comments=kind==='replies'?result.ChildComments:result.Comments;
    assert.deepEqual(comments.map((c:{id:string})=>c.id),kind==='replies'?['r3','r2']:['c3','c2']);
    for(const comment of comments) {assert.equal(comment.isFavoritedByUser,true);assert.deepEqual(comment.SubscribedToNotifications,[{username:'actor'}]);}
    if(kind==='replies') {assert.equal(result.aggregateChildCommentCount,3);assert.deepEqual(comments[0].ParentComment,{id:'parent'});}
    if(kind==='section') assert.deepEqual(result.DiscussionChannel,{discussionId:'d',channelUniqueName:'forum',SubscribedToNotifications:[{username:'actor'}],Channel:{uniqueName:'forum'},Discussion:{id:'d'}});
    if(kind==='event') assert.deepEqual(result.Event,{id:'event',SubscribedToNotifications:[{username:'actor'}],SubscribedToEventUpdates:[{username:'actor'}]});
    const switched=data(await execute(queries[kind],'other')).result;
    const switchedComments=kind==='replies'?switched.ChildComments:switched.Comments;
    assert.deepEqual(switchedComments[0].SubscribedToNotifications,[{username:'other'}]);
  });
  test(`${kind}: anonymous and unrelated viewers do not inherit another user's state`,async()=>{
    await seed();
    for(const user of [null,'outsider']) {
      const result=data(await execute(queries[kind],user)).result;
      for(const comment of kind==='replies'?result.ChildComments:result.Comments) {assert.equal(comment.isFavoritedByUser,false);assert.deepEqual(comment.SubscribedToNotifications,[]);}
      if(kind==='section') assert.deepEqual(result.DiscussionChannel.SubscribedToNotifications,[]);
      if(kind==='event') {assert.deepEqual(result.Event.SubscribedToNotifications,[]);assert.deepEqual(result.Event.SubscribedToEventUpdates,[]);}
    }
  });
}
for(const kind of ['detail','list','channels'] as const) {
  test(`${kind}: favorites and viewer-only votes retain signed-in/anonymous distinctions`,async()=>{
    await seed();
    for(const user of ['actor','other','outsider',null]) {
      const result=data(await execute(queries[kind],user)).result;
      const item=kind==='detail'?result[0]:kind==='list'?result.discussionChannels[0]:result.channels[0];
      const favorite=item.isFavorited;
      assert.equal(favorite,user===null?null:user!=='outsider');
      if(kind!=='channels') {
        const channel=kind==='detail'?item.DiscussionChannels[0]:item;
        const identities=user && user!=='outsider'?[{username:user}]:[];
        assert.deepEqual(channel.UpvotedByUsers,identities);assert.deepEqual(channel.SuperUpvotedByUsers,identities);
      }
    }
  });
}
test('missing targets retain empty and nullable wrapper shapes',async()=>{
  assert.deepEqual(data(await execute(queries.replies)).result,{aggregateChildCommentCount:0,ChildComments:[]});
  assert.deepEqual(data(await execute(queries.section)).result,{DiscussionChannel:null,Comments:[]});
  assert.deepEqual(data(await execute(queries.event)).result,{Event:null,Comments:[]});
  assert.deepEqual(data(await execute(queries.detail)).result,[]);
  assert.deepEqual(data(await execute(queries.list)).result,{discussionChannels:[]});
  assert.deepEqual(data(await execute(queries.channels)).result,{channels:[]});
});
test('sensitive discussions retain hidden reply/section/detail/list behavior',async()=>{
  await seed();await driver.executeQuery("MATCH(d:Discussion) SET d.hasSensitiveContent=true");
  assert.deepEqual(data(await execute(queries.replies)).result,{aggregateChildCommentCount:0,ChildComments:[]});
  assert.deepEqual(data(await execute(queries.section)).result,{DiscussionChannel:null,Comments:[]});
  assert.deepEqual(data(await execute(queries.detail)).result,[]);
  assert.deepEqual(data(await execute(queries.list)).result,{discussionChannels:[]});
});
test('archived channel filtering remains list-specific while detail context is retained',async()=>{
  await seed();await driver.executeQuery("MATCH(dc:DiscussionChannel) SET dc.archived=true");
  assert.deepEqual(data(await execute(queries.list)).result,{discussionChannels:[]});
  assert.equal(data(await execute(queries.detail)).result[0].id,'d');
  assert.equal(data(await execute(queries.section)).result.DiscussionChannel.discussionId,'d');
});
test('raw persisted text retains selection-dependent GraphQL failure',async()=>{
  await seed();await driver.executeQuery("MATCH(c:Comment) SET c.text=['invalid','text']");
  for(const kind of ['replies','section','event'] as const) {
    data(await execute(queries[kind]));
    const result=await execute(queries[kind].replace('id isFavoritedByUser','id text isFavoritedByUser'));
    assert.match(result.errors?.[0].message??'',/String cannot represent/);
  }
});
test('explicit nullable filters/pagination preserve default handling',async()=>{
  await seed();
  data(await execute('{result:getCommentReplies(commentId:"parent",sort:null,modName:null,limit:null,offset:null){aggregateChildCommentCount}}'));
  data(await execute('{result:getCommentSection(discussionId:"d",channelUniqueName:"forum",sort:null,modName:null,limit:null,offset:null){Comments{isFavoritedByUser}}}'));
  data(await execute('{result:getDiscussionsInChannel(channelUniqueName:"forum",options:null,searchInput:null,selectedTags:null,labelFilters:null,showArchived:null){discussionChannels{Discussion{isFavorited}}}}'));
  data(await execute('{result:getSortedChannels(countDownloads:null,tags:null,searchInput:null,offset:null,limit:null){channels{isFavorited}}}'));
});

test('discussion list moderator badge remains a computed membership Boolean',async()=>{
  await seed();
  assert.equal(data(await execute(queries.list)).result.discussionChannels[0].Discussion.authorIsChannelModerator,false);
  await driver.executeQuery("MATCH(u:User {username:'other'}),(d:Discussion),(ch:Channel) CREATE(u)-[:POSTED_DISCUSSION]->(d),(u)-[:ADMIN_OF_CHANNEL]->(ch)");
  assert.equal(data(await execute(queries.list)).result.discussionChannels[0].Discussion.authorIsChannelModerator,true);
});
test('missing optional Cypher parameters retain existing wrapped errors',async()=>{
  await seed();
  for(const kind of ['replies','section'] as const) {
    const result=await execute(queries[kind].replace('modName:"",',''));
    assert.match(result.errors?.[0].message??'',/Expected parameter\(s\): modName/);
  }
  const result=await execute(queries.channels.replace('countDownloads:false,',''));
  assert.equal(result.errors?.[0].message,'Failed to fetch sorted channels');
});
test('comment hydration failures retain event swallowing versus wrapped discussion errors',async()=>{
  await seed();await driver.executeQuery("MATCH(c:Comment) SET c.createdAt='not-a-temporal-value'");
  for(const kind of ['replies','section'] as const) {
    const result=await execute(queries[kind]);assert.match(result.errors?.[0].message??'',/Failed to fetch comment/);
  }
  assert.deepEqual(data(await execute(queries.event)).result,{Event:null,Comments:[]});
});
test('viewer queries retain anonymous behavior through permission middleware',async()=>{
  await seed();
  for(const kind of Object.keys(queries) as Array<keyof typeof queries>) {
    assert.deepEqual(data(await execute(queries[kind],null,true)),data(await execute(queries[kind],null)));
  }
});
test('comment pagination preserves empty limit and ordered offsets',async()=>{
  await seed();
  for(const kind of ['replies','section','event'] as const) {
    const empty=data(await execute(queries[kind].replace('limit:2','limit:0'))).result;
    assert.deepEqual(kind==='replies'?empty.ChildComments:empty.Comments,[]);
    const page=data(await execute(queries[kind].replace('limit:2','limit:1,offset:1'))).result;
    assert.equal((kind==='replies'?page.ChildComments:page.Comments)[0].id,kind==='replies'?'r2':'c2');
  }
});

for (const field of ['UpvotedByUsers', 'SuperUpvotedByUsers']) {
  test(`discussion list canonical ${field} survives a sibling field alias`, async () => {
    await seed();
    const source = `{result:getDiscussionsInChannel(channelUniqueName:"forum",options:{sort:new}) {discussionChannels {Flairs:${field} {username}}}}`;
    for (const actor of ['actor', 'other', 'outsider', null]) {
      assert.deepEqual(data(await execute(source, actor, true)).result.discussionChannels,
        [{Flairs: actor && actor !== 'outsider' ? [{username:actor}] : []}]);
    }
  });
}
test('discussion list canonical author scalar aliases retain their own values', async () => {
  await seed();
  await driver.executeQuery("MATCH(u:User {username:'actor'}),(d:Discussion) SET u.displayName='Actor display' CREATE(u)-[:POSTED_DISCUSSION]->(d)");
  const result = data(await execute(`{result:getDiscussionsInChannel(channelUniqueName:"forum",options:{sort:new}) {discussionChannels {Discussion {Author {displayName:username username:displayName}}}}}`, 'actor', true));
  assert.deepEqual(result.result.discussionChannels[0].Discussion.Author, {displayName:'actor',username:'Actor display'});
});

async function seedListChildren() {
  await seed();
  await driver.executeQuery(`MATCH(u:User {username:'actor'}),(d:Discussion),(dc:DiscussionChannel),(ch:Channel)
    SET u.displayName='Actor display',d.title='Title'
    CREATE(u)-[:POSTED_DISCUSSION]->(d),
      (d)-[:HAS_ALBUM]->(a:Album {id:'album',imageOrder:['image']}),
      (a)-[:HAS_IMAGE]->(:Image {id:'image',url:'https://image.invalid',alt:'Alternative',caption:'Caption'}),
      (d)-[:HAS_TAG]->(:Tag {text:'tag'}),
      (d)-[:HAS_DOWNLOADABLE_FILE]->(:DownloadableFile {id:'file',scanStatus:'CLEAN'}),
      (dc)-[:HAS_DISCUSSION_FLAIR]->(f:DiscussionFlair {id:'flair',displayName:'Category',color:'blue',order:1,archived:false}),
      (ch)-[:HAS_DISCUSSION_FLAIR]->(f)`);
}
function assertKeys<T extends object>(value:T, keys:Record<keyof T,true>) {
  assert.deepEqual(Object.keys(value).sort(),Object.keys(keys).sort());
}
test('actual discussion hydration document retains its exact declared map projections',async()=>{
  await seedListChildren();
  const session=driver.session();
  const result=await session.run<{DiscussionChannel:DiscussionListViewerChannel}>(getDiscussionChannelsQuery,
    {discussionChannelIds:['dc'],loggedInUsername:'actor',mayAccessSensitiveContent:false}).finally(()=>session.close());
  const row=result.records[0]!.get('DiscussionChannel');
  assertKeys(row,{id:true,archived:true,answered:true,locked:true,discussionId:true,createdAt:true,
    channelUniqueName:true,weightedVotesCount:true,Flairs:true,CommentsAggregate:true,UpvotedByUsers:true,
    UpvotedByUsersAggregate:true,SuperUpvotedByUsers:true,Discussion:true,Channel:true,isFavorited:true});
  assertKeys(row.CommentsAggregate,{count:true});assertKeys(row.UpvotedByUsersAggregate,{count:true});
  assertKeys(row.Channel,{uniqueName:true});
  for(const votes of [row.UpvotedByUsers,row.SuperUpvotedByUsers]) {
    assert.equal(votes.length,1); assertKeys(votes[0]!,{username:true});assert.equal(votes[0]!.username,'actor');
  }
  const d=row.Discussion;
  assertKeys(d,{id:true,title:true,body:true,createdAt:true,updatedAt:true,hasSensitiveContent:true,hasSpoiler:true,
    Author:true,Album:true,Tags:true,DownloadableFiles:true,authorIsChannelModerator:true});
  assert.ok(d.Author);assertKeys(d.Author,{username:true,displayName:true,profilePicURL:true,createdAt:true,discussionKarma:true,commentKarma:true});
  assert.ok(d.Album);assertKeys(d.Album,{id:true,imageOrder:true,Images:true});
  assert.equal(d.Album.Images.length,1);assertKeys(d.Album.Images[0]!,{id:true,url:true,alt:true,caption:true,archived:true,permanentlyRemoved:true});
  assert.equal(d.Tags.length,1);assertKeys(d.Tags[0]!,{text:true});
  assert.equal(d.DownloadableFiles.length,1);assertKeys(d.DownloadableFiles[0]!,{id:true,scanStatus:true});
  assert.equal(row.Flairs.length,1);assertKeys(row.Flairs[0]!,{id:true,channelUniqueName:true,displayName:true,color:true,order:true,archived:true});
});
test('discussion list nested canonical maps preserve aliases and directive variables',async()=>{
  await seedListChildren();
  const source=`query($skip:Boolean!){result:getDiscussionsInChannel(channelUniqueName:"forum",options:{sort:new}) {
    discussionChannels {...Parts}}} fragment Parts on DiscussionChannelListItem {
      Flairs {color:displayName displayName:color}
      Discussion {Author {displayName:username username:displayName}
        Album {Images {alt:caption caption:alt}} Tags {id:text} DownloadableFiles {scanStatus:id}}
      skipped:UpvotedByUsers @skip(if:$skip) {username}
    }`;
  const result=await graphql({schema:secured,source,variableValues:{skip:true},contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false,user:{username:'actor',email:null,email_verified:true,data:null}}});
  assert.deepEqual(data(result).result.discussionChannels,[{
    Flairs:[{color:'Category',displayName:'blue'}],Discussion:{
      Author:{displayName:'actor',username:'Actor display'},Album:{Images:[{alt:'Caption',caption:'Alternative'}]},
      Tags:[{id:'tag'}],DownloadableFiles:[{scanStatus:'file'}]}
  }]);
});
test('discussion list raw leaves still fail only when selected and retain aliased error paths',async()=>{
  await seedListChildren();
  await driver.executeQuery("MATCH(u:User {username:'actor'}) SET u.displayName=['invalid','name']");
  data(await execute(queries.list,'actor',true));
  const result=await execute(`{result:getDiscussionsInChannel(channelUniqueName:"forum",options:{sort:new}) {discussionChannels {Discussion {Author {bad:displayName}}}}}`,'actor',true);
  assert.match(result.errors?.[0].message??'',/String cannot represent/);
  assert.deepEqual(result.errors?.[0].path,['result','discussionChannels',0,'Discussion','Author','bad']);
});
