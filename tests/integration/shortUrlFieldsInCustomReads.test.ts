/**
 * The frontend builds short URLs (/forums/cats/discussions/7-title,
 * .../comments/<shortId>, /u/alice/images/3) from numbers it selects on the
 * list, detail and comment reads. Those reads are served by hand-written
 * Cypher projections, so a number the projection omits comes back null (or,
 * for a non-null relationship such as Discussion.DiscussionChannels, fails the
 * whole selection). These tests run the client's selections through the
 * schema and assert the persisted numbers reach the response.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } } } }).getSchema();
  registerGeneratedSchema(driver, schema);
}, { timeout: 240000 });
after(async () => stopNeo4j());
beforeEach(async () => {
  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (alice:User {username:'alice'}),
      (forum:Channel {uniqueName:'forum'}),
      (d:Discussion {id:'d',title:'Title',createdAt:datetime('2026-01-01'),hasDownload:false}),
      (dc:DiscussionChannel {id:'dc',discussionId:'d',discussionNumber:7,channelUniqueName:'forum',
        createdAt:datetime('2026-01-01'),archived:false}),
      (album:Album {id:'album',imageOrder:['image']}),
      (image:Image {id:'image',imageNumber:3,url:'https://example.test/image.png',createdAt:datetime('2026-01-01')}),
      (cross:Discussion {id:'cross',title:'Original',createdAt:datetime('2026-01-01')}),
      (crossDc:DiscussionChannel {id:'crossDc',discussionId:'cross',discussionNumber:12,channelUniqueName:'forum',
        createdAt:datetime('2026-01-01')}),
      (collection:Collection {id:'collection',collectionNumber:5,ownerUsername:'alice',name:'Shared',visibility:'PUBLIC'}),
      (answer:Comment {id:'answer',shortId:'ans1',text:'answer',createdAt:datetime('2026-01-01')}),
      (root:Comment {id:'root',shortId:'root1',text:'root',isRootComment:true,createdAt:datetime('2026-01-01')}),
      (reply:Comment {id:'reply',shortId:'reply1',text:'reply',isRootComment:false,createdAt:datetime('2026-01-02')}),
      (event:Event {id:'event',title:'Event',createdAt:datetime('2026-01-01')}),
      (ec:EventChannel {id:'ec',eventId:'event',eventNumber:4,channelUniqueName:'forum'}),
      (eventRoot:Comment {id:'eventRoot',shortId:'evroot1',text:'event root',isRootComment:true,createdAt:datetime('2026-01-01')}),
      (eventReply:Comment {id:'eventReply',shortId:'evreply1',text:'event reply',isRootComment:false,createdAt:datetime('2026-01-02')})
    CREATE (alice)-[:POSTED_DISCUSSION]->(d),
      (dc)-[:POSTED_IN_CHANNEL]->(d),(dc)-[:POSTED_IN_CHANNEL]->(forum),
      (d)-[:HAS_ALBUM]->(album),(album)-[:HAS_IMAGE]->(image),(alice)-[:UPLOADED_IMAGE]->(image),
      (d)-[:CROSSPOSTED_DISCUSSION]->(cross),(crossDc)-[:POSTED_IN_CHANNEL]->(cross),(crossDc)-[:POSTED_IN_CHANNEL]->(forum),
      (cross)-[:HAS_ALBUM]->(album),
      (d)-[:SHARES_COLLECTION]->(collection),(collection)-[:CREATED_BY]->(alice),
      (answer)-[:IS_REPLY_TO]->(dc),(alice)-[:AUTHORED_COMMENT]->(answer),
      (dc)-[:CONTAINS_COMMENT]->(root),(dc)-[:CONTAINS_COMMENT]->(reply),(reply)-[:IS_REPLY_TO]->(root),
      (ec)-[:POSTED_IN_CHANNEL]->(event),(ec)-[:POSTED_IN_CHANNEL]->(forum),
      (event)-[:HAS_COMMENT]->(eventRoot),(event)-[:HAS_COMMENT]->(eventReply),(eventReply)-[:IS_REPLY_TO]->(eventRoot)`);
});

async function read(source: string) {
  const result = await graphql({ schema, source,
    contextValue: { driver, req: { headers: {} }, mayAccessSensitiveContent: false, user: undefined } });
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data)).result;
}

test("forum discussion list exposes the listed forum's discussion number and image numbers", async () => {
  const result = await read(`{result:getDiscussionsInChannel(channelUniqueName:"forum",options:{sort:new}) {
    discussionChannels { id Discussion { id
      DiscussionChannels(where:{channelUniqueName:{eq:"forum"}}) { id discussionId discussionNumber channelUniqueName }
      Album { Images { id imageNumber } } } } }}`);
  assert.deepEqual(result.discussionChannels.filter((entry: { id: string }) => entry.id === "dc"), [{ id: "dc", Discussion: { id: "d",
    DiscussionChannels: [{ id: "dc", discussionId: "d", discussionNumber: 7, channelUniqueName: "forum" }],
    Album: { Images: [{ id: "image", imageNumber: 3 }] } } }]);
});

test("site-wide discussion list exposes each forum's discussion number and image numbers", async () => {
  const result = await read(`{result:getSiteWideDiscussionList(searchInput:"",showArchived:false,options:{sort:new}) {
    discussions { id DiscussionChannels { channelUniqueName discussionNumber } Album { Images { id imageNumber } } } }}`);
  assert.deepEqual(result.discussions.find((discussion: { id: string }) => discussion.id === "d"), { id: "d",
    DiscussionChannels: [{ channelUniqueName: "forum", discussionNumber: 7 }],
    Album: { Images: [{ id: "image", imageNumber: 3 }] } });
});

test("discussion detail exposes numbers for its forum entry, images, answers, crosspost and shared collection", async () => {
  const result = await read(`{result:getDiscussionDetail(channelUniqueName:"forum",discussionNumber:7) {
    id Album { Images { id imageNumber } }
    DiscussionChannels { discussionNumber Answers { id shortId } }
    CrosspostedDiscussion { Album { Images { imageNumber } } DiscussionChannels { channelUniqueName discussionNumber } }
    SharedCollection { collectionNumber ownerUsername } }}`);
  assert.deepEqual(result, [{ id: "d", Album: { Images: [{ id: "image", imageNumber: 3 }] },
    DiscussionChannels: [{ discussionNumber: 7, Answers: [{ id: "answer", shortId: "ans1" }] }],
    CrosspostedDiscussion: { Album: { Images: [{ imageNumber: 3 }] },
      DiscussionChannels: [{ channelUniqueName: "forum", discussionNumber: 12 }] },
    SharedCollection: { collectionNumber: 5, ownerUsername: "alice" } }]);
});

test("discussion detail pages expose image numbers and answer shortIds", async () => {
  const images = await read(`{result:getDiscussionDetailImages(discussionId:"d",channelUniqueName:"forum") { images { id imageNumber } }}`);
  const answers = await read(`{result:getDiscussionDetailAnswers(discussionId:"d",channelUniqueName:"forum") { answers { id shortId } }}`);
  assert.deepEqual({ images, answers }, {
    images: { images: [{ id: "image", imageNumber: 3 }] },
    answers: { answers: [{ id: "answer", shortId: "ans1" }] } });
});

test("comment section exposes the forum entry's discussion number and answer shortIds", async () => {
  const result = await read(`{result:getCommentSection(channelUniqueName:"forum",discussionNumber:7,sort:"new") {
    DiscussionChannel { discussionNumber Answers { shortId } } Comments { id shortId } }}`);
  assert.deepEqual(result, { DiscussionChannel: { discussionNumber: 7, Answers: [{ shortId: "ans1" }] },
    Comments: [{ id: "root", shortId: "root1" }] });
});

test("discussion comment replies expose the parent shortId and the forum entry's discussion number", async () => {
  const result = await read(`{result:getCommentReplies(commentId:"root",sort:new) { ChildComments { id shortId
    ParentComment { id shortId } Event { EventChannels { channelUniqueName eventNumber } }
    DiscussionChannel { id channelUniqueName discussionId discussionNumber } } }}`);
  assert.deepEqual(result.ChildComments, [{ id: "reply", shortId: "reply1",
    ParentComment: { id: "root", shortId: "root1" }, Event: null,
    DiscussionChannel: { id: "dc", channelUniqueName: "forum", discussionId: "d", discussionNumber: 7 } }]);
});

test("event comment replies expose the event's per-forum numbers", async () => {
  const result = await read(`{result:getCommentReplies(commentId:"eventRoot",sort:new) { ChildComments { id
    ParentComment { shortId } Event { EventChannels { channelUniqueName eventNumber } } DiscussionChannel { id } } }}`);
  assert.deepEqual(result.ChildComments, [{ id: "eventReply", ParentComment: { shortId: "evroot1" },
    Event: { EventChannels: [{ channelUniqueName: "forum", eventNumber: 4 }] }, DiscussionChannel: null }]);
});

test("event comments expose event numbers on the event, each comment and reply shortIds", async () => {
  const result = await read(`{result:getEventComments(eventId:"event",sort:new) {
    Event { EventChannels { id eventId eventNumber channelUniqueName } }
    Comments { id shortId Event { EventChannels { channelUniqueName eventNumber } } ChildComments { id shortId } } }}`);
  assert.deepEqual(result, {
    Event: { EventChannels: [{ id: "ec", eventId: "event", eventNumber: 4, channelUniqueName: "forum" }] },
    Comments: [{ id: "eventRoot", shortId: "evroot1",
      Event: { EventChannels: [{ channelUniqueName: "forum", eventNumber: 4 }] },
      ChildComments: [{ id: "eventReply", shortId: "evreply1" }] }] });
});
