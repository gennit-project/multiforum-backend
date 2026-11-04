import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
  secured = applyMiddleware(schema, permissions);
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
