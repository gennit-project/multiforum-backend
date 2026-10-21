import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createNotificationSnapshotRepository, FULL_COMMENT_SELECTION_SET } from "../../services/persistence/notificationSnapshotRepository.js";
import { installRequestScopedBookmarks } from "../../services/requestScopedBookmarks.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
before(async () => {
  driver = installRequestScopedBookmarks(await startNeo4j());
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true } });
  const schema = await neoSchema.getSchema();
  initializeOgmFromExistingSchema(ogm, neoSchema, schema);
  registerGeneratedSchema(driver, schema);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const equal = async (old: Promise<unknown>, current: Promise<unknown>) => assert.deepEqual(plain(await current), plain(await old));

const commentSelection = `{id text CommentAuthor {... on User {username displayName} ... on ModerationProfile {displayName User {username}}} DiscussionChannel {discussionId channelUniqueName Discussion {id title}} Event {id title EventChannels {channelUniqueName}}}`;
const discussionSelection = `{id title body Author {username displayName} DiscussionChannels {channelUniqueName}}`;
const subscriberSelection = `{id SubscribedToNotifications {username Email {address}}}`;
const issueSelection = `{id issueNumber title channelUniqueName SubscribedToNotifications {username notifyOnSubscribedIssueUpdates Email {address}}}`;
const seed = async () => driver.executeQuery(`
  CREATE (author:User {username:'author',displayName:'Author'})
  CREATE (reader:User {username:'reader',notifyOnFeedback:true,notifyWhenTagged:true,notifyOnSubscribedIssueUpdates:false})
  CREATE (email:Email {address:'reader@example.test'})-[:HAS_EMAIL]->(reader)
  CREATE (channel:Channel {uniqueName:'channel'})
  CREATE (discussion:Discussion {id:'discussion',title:'Title',body:'Hello @reader'})
  CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
  CREATE (dc:DiscussionChannel {id:'dc',discussionId:'discussion',channelUniqueName:'channel'})
  CREATE (dc)-[:POSTED_IN_CHANNEL]->(discussion)
  CREATE (dc)-[:POSTED_IN_CHANNEL]->(channel)
  CREATE (event:Event {id:'event',title:'Event'})
  CREATE (author)-[:POSTED_BY]->(event)
  CREATE (ec:EventChannel {id:'ec',eventId:'event',channelUniqueName:'channel'})
  CREATE (ec)-[:POSTED_IN_CHANNEL]->(event)
  CREATE (ec)-[:POSTED_IN_CHANNEL]->(channel)
  CREATE (comment:Comment {id:'comment',text:'Hi @reader',isRootComment:true,isFeedbackComment:false})
  CREATE (author)-[:AUTHORED_COMMENT]->(comment)
  CREATE (dc)-[:CONTAINS_COMMENT]->(comment)
  CREATE (channel)-[:HAS_COMMENT]->(comment)
  CREATE (event)-[:HAS_COMMENT]->(comment)
  CREATE (issue:Issue {id:'issue',issueNumber:1,title:'Issue',channelUniqueName:'channel'})
  CREATE (reader)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc)
  CREATE (reader)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(event)
  CREATE (reader)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(comment)
  CREATE (reader)-[:SUBSCRIBED_TO_ISSUE]->(issue)
`);
const compareAll = async () => {
  const repo = createNotificationSnapshotRepository(driver);
  await equal(ogm.model("User").find({where:{username:"reader"},selectionSet:"{username}"}), repo.findArchivedAuthor("reader"));
  await equal(ogm.model("User").find({where:{username:"reader"},selectionSet:"{username notifyOnFeedback}"}), repo.findFeedbackRecipient("reader"));
  await equal(ogm.model("User").find({where:{username_IN:["reader","author"]},selectionSet:"{username notifyWhenTagged Email {address}}"}), repo.findMentionRecipients(["reader","author"]));
  await equal(ogm.model("Comment").find({where:{id:"comment"},selectionSet:commentSelection}), repo.findCommentMentionSnapshot("comment"));
  await equal(ogm.model("Discussion").find({where:{id:"discussion"},selectionSet:discussionSelection}), repo.findDiscussionMentionSnapshot("discussion"));
  await equal(ogm.model("Comment").find({where:{id:"comment"},selectionSet:FULL_COMMENT_SELECTION_SET}), repo.findCommentNotificationSnapshot("comment"));
  for (const [type,id] of [["Comment","comment"],["DiscussionChannel","dc"],["Event","event"]] as const) {
    await equal(ogm.model(type).find({where:{id},selectionSet:subscriberSelection}), repo.findEntitySubscribers(type,id));
  }
  await equal(ogm.model("Issue").find({where:{id:"issue"},selectionSet:issueSelection}), repo.findIssueSubscribers("issue"));
};

test("all eight snapshots preserve missing results", compareAll);
test("all eight snapshots match production schema and leave graph unchanged", async () => {
  await seed();
  const before = await driver.executeQuery("MATCH (n) RETURN count(n) AS count");
  await compareAll();
  const [issue] = await createNotificationSnapshotRepository(driver).findIssueSubscribers("issue");
  assert.deepEqual(plain(issue.SubscribedToNotifications), [{username:"reader",notifyOnSubscribedIssueUpdates:false,Email:{address:"reader@example.test"}}]);
  const after = await driver.executeQuery("MATCH (n) RETURN count(n) AS count");
  assert.equal(after.records[0].get("count").toNumber(), before.records[0].get("count").toNumber());
});
test("anonymous snapshot filters apply to restricted roots and nested discussions", async () => {
  await seed();
  await driver.executeQuery("MATCH (d:Discussion {id:'discussion'}) SET d.hasSensitiveContent=true");
  await compareAll();
  assert.deepEqual(await createNotificationSnapshotRepository(driver).findDiscussionMentionSnapshot("discussion"), []);
  await driver.executeQuery("MATCH (c:Comment {id:'comment'}) SET c.ageGateRestricted=true");
  await compareAll();
  assert.deepEqual(await createNotificationSnapshotRepository(driver).findCommentNotificationSnapshot("comment"), []);
});
test("mention snapshots retain case-sensitive matching and the generated default user limit", async () => {
  const usernames = Array.from({length:30},(_,i)=>`user${i}`);
  await driver.executeQuery("UNWIND $usernames AS name CREATE (:User {username:name})", {usernames});
  const repo = createNotificationSnapshotRepository(driver);
  await equal(ogm.model("User").find({where:{username_IN:usernames},selectionSet:"{username notifyWhenTagged Email {address}}"}), repo.findMentionRecipients(usernames));
  assert.equal((await repo.findMentionRecipients(usernames)).length,25);
  assert.deepEqual(await repo.findMentionRecipients(["USER0"]),[]);
});
test("malformed selected fields retain the first OGM error message", async () => {
  await seed();
  await driver.executeQuery("MATCH (u:User {username:'reader'}) SET u.notifyOnFeedback='invalid'");
  let message = "";
  await assert.rejects(ogm.model("User").find({where:{username:"reader"},selectionSet:"{username notifyOnFeedback}"}), error => {message=(error as Error).message; return true;});
  await assert.rejects(createNotificationSnapshotRepository(driver).findFeedbackRecipient("reader"), error => {assert.equal((error as Error).message,message); return true;});
});

test("moderator authors, parent subscribers and feedback targets retain full nested selections", async () => {
  await seed();
  await driver.executeQuery(`
    MATCH (author:User {username:'author'}), (reader:User {username:'reader'}),
          (comment:Comment {id:'comment'}), (discussion:Discussion {id:'discussion'}), (event:Event {id:'event'})
    MATCH (author)-[authored:AUTHORED_COMMENT]->(comment) DELETE authored
    CREATE (profile:ModerationProfile {displayName:'Moderator'})
    CREATE (author)-[:MODERATION_PROFILE]->(profile)
    CREATE (profile)-[:AUTHORED_COMMENT]->(comment)
    CREATE (parent:Comment {id:'parent',text:'Parent',isRootComment:true,isFeedbackComment:false})
    CREATE (reader)-[:AUTHORED_COMMENT]->(parent)
    CREATE (comment)-[:IS_REPLY_TO]->(parent)
    CREATE (author)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(parent)
    CREATE (comment)-[:HAS_FEEDBACK_COMMENT]->(parent)
    CREATE (comment)-[:HAS_FEEDBACK_COMMENT]->(discussion)
    CREATE (comment)-[:HAS_FEEDBACK_COMMENT]->(event)
  `);
  await compareAll();
  const [comment] = await createNotificationSnapshotRepository(driver).findCommentNotificationSnapshot("comment");
  assert.equal(comment.CommentAuthor?.__typename, "ModerationProfile");
  assert.equal(comment.ParentComment?.id, "parent");
  assert.equal(comment.GivesFeedbackOnComment?.id, "parent");
  assert.equal(comment.GivesFeedbackOnDiscussion?.id, "discussion");
  assert.equal(comment.GivesFeedbackOnEvent?.id, "event");
  assert.equal(comment.ParentComment?.SubscribedToNotifications[0]?.username,"author");
});
