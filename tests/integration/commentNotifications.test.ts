// Integration tests for the comment-notification pipeline's callable core
// (handleCommentCreatedNotification), extracted from the subscription class so
// it can run directly against a live Neo4j container. Covers the three fan-out
// paths that write Notification nodes — discussion, event, and reply — plus the
// commenter-exclusion rule. Email sending no-ops here because no mail provider
// is configured.

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleCommentCreatedNotification } from "../../services/commentNotificationHandler.js";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
});

const deps = () => ({ driver: env.driver });

const notificationsFor = (username: string) =>
  run(
    `MATCH (:User { username: $username })-[:HAS_NOTIFICATION]->(n:Notification)
     RETURN n.text AS text, n.notificationType AS type`,
    { username }
  );

// --- Discussion comment ---

test("a comment on a discussion notifies subscribers but not the commenter", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (alice:User { username: 'alice' })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (c:Comment { id: 'c1', text: 'nice post', isRootComment: true, createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (dc)-[:CONTAINS_COMMENT]->(c)
     CREATE (ch)-[:HAS_COMMENT]->(c)
     CREATE (bob)-[:AUTHORED_COMMENT]->(c)
     CREATE (alice)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc)
     CREATE (bob)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc)`
  );

  await handleCommentCreatedNotification(deps(), "c1");

  const aliceNotifs = await notificationsFor("alice");
  assert.equal(aliceNotifs.length, 1, "subscriber should be notified");
  assert.match(aliceNotifs[0].text, /My Discussion/);
  assert.equal(aliceNotifs[0].type, "reply");

  const bobNotifs = await notificationsFor("bob");
  assert.equal(bobNotifs.length, 0, "the commenter should not be notified of their own comment");
});

// --- Event comment ---

test("a comment on an event notifies subscribers", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (alice:User { username: 'alice' })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (e:Event { id: 'e1', title: 'My Event' })
     CREATE (ec:EventChannel { id: 'ec1', channelUniqueName: 'cats', eventId: 'e1' })
     CREATE (c:Comment { id: 'c1', text: 'see you there', isRootComment: true, createdAt: datetime() })
     CREATE (ec)-[:POSTED_IN_CHANNEL]->(e)
     CREATE (ec)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (e)-[:HAS_COMMENT]->(c)
     CREATE (ch)-[:HAS_COMMENT]->(c)
     CREATE (bob)-[:AUTHORED_COMMENT]->(c)
     CREATE (alice)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(e)`
  );

  await handleCommentCreatedNotification(deps(), "c1");

  const aliceNotifs = await notificationsFor("alice");
  assert.equal(aliceNotifs.length, 1, "event subscriber should be notified");
  assert.match(aliceNotifs[0].text, /My Event/);
});

// --- Reply ---

test("a reply notifies the parent comment author who opted in to reply notifications", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (alice:User { username: 'alice', notifyOnReplyToCommentByDefault: true })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (parent:Comment { id: 'p1', text: 'original', isRootComment: true, createdAt: datetime() })
     CREATE (reply:Comment { id: 'r1', text: 'a reply', isRootComment: false, createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (dc)-[:CONTAINS_COMMENT]->(reply)
     CREATE (ch)-[:HAS_COMMENT]->(reply)
     CREATE (alice)-[:AUTHORED_COMMENT]->(parent)
     CREATE (bob)-[:AUTHORED_COMMENT]->(reply)
     CREATE (reply)-[:IS_REPLY_TO]->(parent)`
  );

  await handleCommentCreatedNotification(deps(), "r1");

  const aliceNotifs = await notificationsFor("alice");
  assert.equal(aliceNotifs.length, 1, "parent author should be notified of the reply");
  assert.match(aliceNotifs[0].text, /replied to your comment/);
});

test("a reply does not notify a parent author who opted out", async () => {
  await run(
    `CREATE (bob:User { username: 'bob' })
     CREATE (alice:User { username: 'alice', notifyOnReplyToCommentByDefault: false })
     CREATE (ch:Channel { uniqueName: 'cats', createdAt: datetime() })
     CREATE (d:Discussion { id: 'd1', title: 'My Discussion', createdAt: datetime() })
     CREATE (dc:DiscussionChannel { id: 'dc1', discussionId: 'd1', channelUniqueName: 'cats', createdAt: datetime() })
     CREATE (parent:Comment { id: 'p1', text: 'original', isRootComment: true, createdAt: datetime() })
     CREATE (reply:Comment { id: 'r1', text: 'a reply', isRootComment: false, createdAt: datetime() })
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)
     CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
     CREATE (dc)-[:CONTAINS_COMMENT]->(reply)
     CREATE (ch)-[:HAS_COMMENT]->(reply)
     CREATE (alice)-[:AUTHORED_COMMENT]->(parent)
     CREATE (bob)-[:AUTHORED_COMMENT]->(reply)
     CREATE (reply)-[:IS_REPLY_TO]->(parent)`
  );

  await handleCommentCreatedNotification(deps(), "r1");

  const aliceNotifs = await notificationsFor("alice");
  assert.equal(aliceNotifs.length, 0, "opted-out parent author should not be notified");
});

// --- Missing comment ---

test("handleCommentCreatedNotification is a no-op for an unknown comment id", async () => {
  await handleCommentCreatedNotification(deps(), "does-not-exist");
  const all = await run(`MATCH (n:Notification) RETURN count(n) AS n`);
  assert.equal(Number(all[0].n), 0);
});

// Nullable text is normalized only for the email excerpt. Actual recipients,
// in-app writes and persisted comment text must remain unchanged.
for(const path of ['discussion','event','reply'] as const)for(const text of [null,'**kept excerpt**'])for(const notifyReply of (path==='reply'?[true,false]:[true]))test(`${path} notifications preserve delivery with ${text===null?'null':'non-null'} text${notifyReply?'':' and opted-out author'}`,async(t)=>{
 await run(`
  CREATE(bob:User{username:'bob'}),(alice:User{username:'alice',notifyOnReplyToCommentByDefault:$notifyReply})
  CREATE(ch:Channel{uniqueName:'cats',createdAt:datetime()})
  CREATE(d:Discussion{id:'d1',title:'Discussion',createdAt:datetime()})
  CREATE(dc:DiscussionChannel{id:'dc1',discussionId:'d1',channelUniqueName:'cats',createdAt:datetime()})
  CREATE(e:Event{id:'e1',title:'Event'}),(ec:EventChannel{id:'ec1',eventId:'e1',channelUniqueName:'cats'})
  CREATE(parent:Comment{id:'p1',text:'parent',isRootComment:true,createdAt:datetime()})
  CREATE(c:Comment{id:'c1',text:$text,isRootComment:$root,createdAt:datetime()})
  CREATE(:Email{address:'alice@example.test'})-[:HAS_EMAIL]->(alice)
  CREATE(dc)-[:POSTED_IN_CHANNEL]->(d), (dc)-[:POSTED_IN_CHANNEL]->(ch)
  CREATE(ec)-[:POSTED_IN_CHANNEL]->(e), (ec)-[:POSTED_IN_CHANNEL]->(ch)
  CREATE(ch)-[:HAS_COMMENT]->(c), (bob)-[:AUTHORED_COMMENT]->(c), (alice)-[:AUTHORED_COMMENT]->(parent)
  FOREACH(_ IN CASE WHEN $path='event' THEN [1] ELSE [] END | CREATE(e)-[:HAS_COMMENT]->(c) CREATE(alice)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(e) CREATE(bob)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(e))
  FOREACH(_ IN CASE WHEN $path<>'event' THEN [1] ELSE [] END | CREATE(dc)-[:CONTAINS_COMMENT]->(c) CREATE(alice)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc) CREATE(bob)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc))
  FOREACH(_ IN CASE WHEN $path='reply' THEN [1] ELSE [] END | CREATE(c)-[:IS_REPLY_TO]->(parent) CREATE(bob)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(parent))
 `,{path,text,notifyReply,root:path!=='reply'});
 const {createNotificationSnapshotRepository}=await import('../../services/persistence/notificationSnapshotRepository.js');
 const snapshot=await createNotificationSnapshotRepository(env.driver).findCommentNotificationSnapshot('c1');
 assert.equal(snapshot.length,1);assert.equal(snapshot[0].text,text);
 const {Resend}=await import('resend');const batches:unknown[]=[];
 t.mock.method(Resend.prototype,'post',async(_path:string,body:unknown)=>{batches.push(body);return {data:[],error:null};});
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Notification regression must never send a real HTTP request'));
 const mailKeys=['EMAIL_PROVIDER','EMAIL_FROM','RESEND_API_KEY'] as const;
 const prior=mailKeys.map(key=>[key,process.env[key]] as const);
 t.after(()=>{for(const [key,value] of prior){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 process.env.EMAIL_PROVIDER='resend';process.env.EMAIL_FROM='sender@example.test';process.env.RESEND_API_KEY='re_test_only_do_not_send';
 await handleCommentCreatedNotification(deps(),'c1');
 const expected=path!=='reply'||notifyReply?1:0;
 assert.equal((await notificationsFor('alice')).length,expected);
 assert.deepEqual(await notificationsFor('bob'),[]);
 assert.equal(batches.length,expected);
 if(expected){assert.ok(Array.isArray(batches[0]));assert.equal(batches[0].length,1);
 const message=batches[0][0];assert.ok(message&&typeof message==='object');
 assert.deepEqual(message.to,['alice@example.test']);assert.ok(typeof message.html==='string');assert.ok(typeof message.text==='string');
 assert.ok(message.text.includes(`"${text ?? ''}"`));
 if(text===null){assert.match(message.html,/<blockquote[^>]*>\s*<\/blockquote>/);assert.doesNotMatch(message.html,/kept excerpt/);}
 else assert.match(message.html,/<strong>kept excerpt<\/strong>/);
 }
 const after=await createNotificationSnapshotRepository(env.driver).findCommentNotificationSnapshot('c1');assert.equal(after[0].text,text);
 assert.equal((await run("MATCH(c:Comment{id:'c1'}) RETURN count(c) AS count"))[0].count.toNumber(),1);
});
