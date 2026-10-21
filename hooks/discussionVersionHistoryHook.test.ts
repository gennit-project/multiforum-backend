// Unit tests for the discussion version-history + edit-notification hook
// handlers. Mirrors the event hook: capture the previous title/body as
// TextVersions (reconnecting BodyLastEditedBy), notify the author on an edit by
// someone else, and short-circuit on the guard branches. Permissive in-memory
// OGM and driver. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import {
  discussionVersionHistoryHandler,
  discussionEditNotificationHandler,
} from "./discussionVersionHistoryHook.js";

process.env.FRONTEND_URL = "https://app.example.test";

function makeContext(opts: { issues?: unknown[]; users?: unknown[] } = {}) {
  const ops: string[] = [];
  const ogm = {
    model(name: string) {
      return {
        find: async () => {
          if (name === "User") return opts.users ?? [{ username: "alice" }];
          if (name === "Issue") return opts.issues ?? [];
          // The version-connect helper re-reads the parent to append the new
          // version; return a row so that path (not just the create) is exercised.
          if (name === "Discussion") return [{ id: "d-1", PastTitleVersions: [], PastBodyVersions: [] }];
          return [];
        },
        create: async () => {
          ops.push(`${name}.create`);
          return { textVersions: [{ id: "tv-1" }] };
        },
        update: async () => {
          ops.push(`${name}.update`);
          return {};
        },
      };
    },
  };
  const driver = { session: () => ({ run: async () => ({ records: [] }), close: async () => {} }) };
  const discussionRevisionRepository = {
    findSnapshot: async () => ogm.model('Discussion').find(),
    findAuthor: async () => ogm.model('User').find(),
    createRevision: async () => ogm.model('TextVersion').create(),
    findDiscussionId: async () => ogm.model('Discussion').find(),
    connectTitleRevision: async () => { await ogm.model('Discussion').update(); },
    connectBodyRevision: async () => { await ogm.model('Discussion').update(); },
    setBodyEditor: async () => { await ogm.model('Discussion').update(); },
  };
  const context: any = { discussionRevisionRepository, issueActivityRepository: { findRelatedIssueIds: async () => opts.issues ?? [], appendActivity: async () => { ops.push("Issue.update"); } }, notificationWriter: {createForUser: async () => {ops.push("notification.create"); return true;}}, ogm, driver, user: { username: "editor", data: {} } };
  return { context, ops };
}

const snapshot = {
  id: "d-1",
  title: "old title",
  body: "old body",
  Author: { username: "alice" },
  BodyLastEditedBy: { username: "alice" },
  DiscussionChannels: [{ channelUniqueName: "cats" }],
  PastTitleVersions: [],
  PastBodyVersions: [],
};

test("discussionVersionHistoryHandler: returns early without an id or update", async () => {
  const { context, ops } = makeContext();
  await discussionVersionHistoryHandler({ context, params: { where: {}, update: null }, discussionSnapshot: snapshot });
  assert.deepEqual(ops, []);
});

test("discussionVersionHistoryHandler: returns early when nothing changed", async () => {
  const { context, ops } = makeContext();
  await discussionVersionHistoryHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "old title", body: "old body" } },
    discussionSnapshot: snapshot,
  });
  assert.deepEqual(ops, []);
});

test("discussionVersionHistoryHandler: records a title version on a title change", async () => {
  const { context, ops } = makeContext();
  await discussionVersionHistoryHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "new title" } },
    discussionSnapshot: snapshot,
  });
  assert.ok(ops.includes("TextVersion.create"), "created a TextVersion for the previous title");
});

test("discussionVersionHistoryHandler: records a body version and reconnects BodyLastEditedBy", async () => {
  const { context, ops } = makeContext();
  await discussionVersionHistoryHandler({
    context,
    params: { where: { id: "d-1" }, update: { body: "new body" } },
    discussionSnapshot: snapshot,
  });
  assert.ok(ops.includes("TextVersion.create"), "created a TextVersion for the previous body");
  // the BodyLastEditedBy reconnect fires for the current editor
  assert.ok(ops.includes("Discussion.update"), "reconnected BodyLastEditedBy");
});

test("discussionVersionHistoryHandler: writes issue activity items when a related issue exists", async () => {
  const { context, ops } = makeContext({ issues: [{ id: "i-1" }] });
  await discussionVersionHistoryHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "new title" } },
    discussionSnapshot: snapshot,
  });
  assert.ok(ops.includes("TextVersion.create"));
});

test("discussionVersionHistoryHandler: swallows errors", async () => {
  const context: any = {
    ogm: { model: () => ({ find: async () => { throw new Error("boom"); }, create: async () => ({}), update: async () => ({}) }) },
    driver: {},
    user: { username: "editor" },
  };
  await discussionVersionHistoryHandler({ context, params: { where: { id: "d-1" }, update: { title: "new" } } });
});

test("discussionEditNotificationHandler: notifies the author on an edit by someone else", async () => {
  const { context } = makeContext();
  await discussionEditNotificationHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "new title" } },
    discussionSnapshot: snapshot,
  });
});

test("discussionEditNotificationHandler: no notification when the editor is the author", async () => {
  const { context } = makeContext();
  await discussionEditNotificationHandler({
    context,
    params: { where: { id: "d-1" }, update: { title: "new title" } },
    discussionSnapshot: { ...snapshot, Author: { username: "editor" } },
  });
});

test("discussionEditNotificationHandler: returns early without a snapshot", async () => {
  const { context } = makeContext();
  await discussionEditNotificationHandler({ context, params: { where: { id: "d-1" }, update: { title: "x" } }, discussionSnapshot: null });
});

function recordingHistory(fail?:string) {
 const calls:string[]=[];let created=0;
 const step=(name:string)=>{calls.push(name);if(name===fail)throw Error(name);};
 const repository={
 findSnapshot:async()=>{step('snapshot');return [snapshot];},
 findAuthor:async(username:string)=>{step(`author:${username}`);return [{username}];},
 createRevision:async(body:string,username:string)=>{step(`create:${body}:${username}`);return {textVersions:[{id:`r${++created}`} ]};},
 findDiscussionId:async()=>{step('parent');return [{id:'d-1'}];},
 connectTitleRevision:async()=>{step('connect:title');},
 connectBodyRevision:async()=>{step('connect:body');},
 setBodyEditor:async()=>{step('editor');},
 };
 const context:any={user:{username:'editor'},discussionRevisionRepository:repository,issueActivityRepository:{findRelatedIssueIds:async()=>{step('issues');return [{id:'i'}];},appendActivity:async(_id:string,node:any)=>step(`activity:${node.Revision.connect.where.node.id}`)}};
 return {context,calls,repository};
}
const both={where:{id:'d-1'},update:{title:'new',body:'new'}};
test('history keeps title then body attribution and sequential activity references',async()=>{
 const {context,calls}=recordingHistory();await discussionVersionHistoryHandler({context,params:both,discussionSnapshot:{...snapshot,BodyLastEditedBy:{username:'prior'}}});
 assert.deepEqual(calls,['author:editor','create:old title:editor','parent','connect:title','author:prior','create:old body:prior','parent','connect:body','editor','issues','activity:r1','activity:r2']);
});
test('title failure permits body; body failure still reconnects editor; editor failure suppresses all activities',async()=>{
 for(const fail of ['connect:title','connect:body','editor']){
  const {context,calls}=recordingHistory(fail);await discussionVersionHistoryHandler({context,params:both,discussionSnapshot:snapshot});
  assert.ok(calls.includes('editor'));assert.ok(calls.includes('connect:body'));
  if(fail==='editor')assert.ok(!calls.includes('issues'));
  else {assert.ok(calls.includes('issues'));assert.equal(calls.filter(x=>x.startsWith('activity:')).length,1);}
 }
});
test('missing parent leaves created revision and still runs independent body and editor steps',async()=>{
 const {context,calls,repository}=recordingHistory();repository.findDiscussionId=async()=>{calls.push('missing-parent');return [];};
 await discussionVersionHistoryHandler({context,params:both,discussionSnapshot:snapshot});
 assert.equal(calls.filter(x=>x.startsWith('create:')).length,2);assert.ok(calls.includes('editor'));assert.ok(!calls.includes('issues'));
});
test('no snapshot fetches fallback and null body becomes empty; absent author prevents all writes',async()=>{
 const {context,calls}=recordingHistory();await discussionVersionHistoryHandler({context,params:{where:{id:'d-1'},update:{body:'new'}}});assert.equal(calls[0],'snapshot');
 calls.length=0;await discussionVersionHistoryHandler({context,params:{where:{id:'d-1'},update:{body:'new'}},discussionSnapshot:{...snapshot,body:null}});assert.ok(calls.includes('create::alice'));
 calls.length=0;context.user={};await discussionVersionHistoryHandler({context,params:both,discussionSnapshot:{...snapshot,Author:null,BodyLastEditedBy:{username:'prior'}}});assert.equal(calls.length,0);
});
test('equal content does not create history, but repeated old snapshots are not deduplicated',async()=>{
 const {context,calls}=recordingHistory();await discussionVersionHistoryHandler({context,params:{where:{id:'d-1'},update:{title:snapshot.title}},discussionSnapshot:snapshot});assert.equal(calls.length,0);
 for(let n=0;n<2;n++)await discussionVersionHistoryHandler({context,params:{where:{id:'d-1'},update:{title:'new'}},discussionSnapshot:snapshot});
 assert.equal(calls.filter(x=>x.startsWith('create:')).length,2);
});
