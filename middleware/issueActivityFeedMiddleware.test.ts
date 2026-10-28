// Unit tests for the issue activity-feed middleware, which records "deleted"/
// "edited" activity on the related issue around delete/update mutations. Each
// wrapper is invoked with a stubbed resolver and a permissive in-memory OGM,
// asserting result pass-through and exercising the record / no-record branches.
// The delegated activity-feed writes run against the stub. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./issueActivityFeedMiddleware.js";

const M: any = (middleware as any).Mutation;

function makeCtx() {
  const ogm = {
    model() {
      return {
        find: async () => [],
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
      };
    },
  };
  return { issueActivityMiddlewareRepository: {findCommentAuthor:async()=>[],findDiscussionAuthor:async()=>[],findEventAuthor:async()=>[],findDeleteActivities:async()=>[],closeDeletedIssue:async()=>{}}, issueActivityRepository: {findRelatedIssueIds: async () => [], appendActivity: async () => {}}, ogm, driver: {}, user: { username: "alice" } } as any;
}

// Resolver returning a fixed value, counting invocations.
function resolveWith(value: unknown) {
  const state = { calls: 0 };
  const resolve = async () => {
    state.calls += 1;
    return value;
  };
  return { resolve, state };
}

test("deleteComments records activity when a comment is deleted", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 1 });
  const out = await M.deleteComments(resolve, null, { where: { id: "c-1" } }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 1 });
  assert.equal(state.calls, 1);
});

test("deleteComments does not record when nothing was deleted", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 0 });
  const out = await M.deleteComments(resolve, null, { where: { id: "c-1" } }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 0 });
  assert.equal(state.calls, 1);
});

test("deleteComments passes through when no id is supplied", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 1 });
  const out = await M.deleteComments(resolve, null, { where: {} }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 1 });
  assert.equal(state.calls, 1);
});

test("deleteDiscussions records activity when a discussion is deleted", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 1 });
  const out = await M.deleteDiscussions(resolve, null, { where: { id: "d-1" } }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 1 });
  assert.equal(state.calls, 1);
});

test("deleteEvents records activity when an event is deleted", async () => {
  const { resolve, state } = resolveWith({ nodesDeleted: 1 });
  const out = await M.deleteEvents(resolve, null, { where: { id: "e-1" } }, makeCtx(), {});
  assert.deepEqual(out, { nodesDeleted: 1 });
  assert.equal(state.calls, 1);
});

test("updateEvents records an edit when there are updates", async () => {
  const { resolve, state } = resolveWith({ events: [{ id: "e-1" }] });
  const out = await M.updateEvents(resolve, null, { where: { id: "e-1" }, update: { title: "new" } }, makeCtx(), {});
  assert.deepEqual(out, { events: [{ id: "e-1" }] });
  assert.equal(state.calls, 1);
});

test("updateEvents does not record when the update is empty", async () => {
  const { resolve, state } = resolveWith({ events: [] });
  await M.updateEvents(resolve, null, { where: { id: "e-1" }, update: {} }, makeCtx(), {});
  assert.equal(state.calls, 1);
});

test("updateEvents passes through when no id is supplied", async () => {
  const { resolve, state } = resolveWith({ events: [] });
  await M.updateEvents(resolve, null, { where: {}, update: { title: "new" } }, makeCtx(), {});
  assert.equal(state.calls, 1);
});

test("updateEventWithChannelConnections records an edit when an id is present", async () => {
  const { resolve, state } = resolveWith({ id: "e-1" });
  await M.updateEventWithChannelConnections(resolve, null, { where: { id: "e-1" } }, makeCtx(), {});
  assert.equal(state.calls, 1);
});

test("updateEventWithChannelConnections passes through with no id", async () => {
  const { resolve, state } = resolveWith({ id: null });
  await M.updateEventWithChannelConnections(resolve, null, { where: {} }, makeCtx(), {});
  assert.equal(state.calls, 1);
});

function recordingContext(options: {closeFailure?:boolean;checkFailure?:boolean;priorDelete?:boolean;authorFailure?:boolean;own?:boolean}={}) {
 const calls:string[]=[];const nodes:any[]=[];
 const read=async()=>{calls.push('author');if(options.authorFailure)throw Error('author failed');return [{CommentAuthor:{username:options.own?'alice':'other',displayName:'Writer'},Author:{username:options.own?'alice':'other',displayName:'Writer'},Poster:{username:options.own?'alice':'other',displayName:'Writer'}}];};
 const context:any={ogm:{model:()=>({})}, user:{username:'alice',data:{ModerationProfile:{displayName:'mod'}}},issueActivityMiddlewareRepository:{
 findCommentAuthor:read,findDiscussionAuthor:read,findEventAuthor:read,
 closeDeletedIssue:async()=>{calls.push('close');if(options.closeFailure)throw Error('close failed');},
 findDeleteActivities:async()=>{calls.push('check');if(options.checkFailure)throw Error('check failed');return options.priorDelete?[{id:'i'}]:[];}
 },issueActivityRepository:{findRelatedIssueIds:async()=>{calls.push('related');return [{id:'i'}];},appendActivity:async(_id:string,node:any)=>{calls.push(`activity:${node.actionType}`);nodes.push(node);}}};
 const resolve=async()=>{calls.push('resolve');return {nodesDeleted:1};};
 return {context,calls,nodes,resolve};
}
for(const kind of ['Comments','Discussions','Events']) test(`delete${kind} retains author-before-delete, close-before-check and activity order`,async()=>{
 const {context,calls,nodes,resolve}=recordingContext({own:true});
 await M[`delete${kind}`](resolve,null,{where:{id:'content'}},context,{});
 assert.deepEqual(calls,['author','resolve','related','close','check','activity:close','activity:delete']);
 for(const node of nodes){assert.equal(node.User.connect.where.node.username,'alice');assert.equal(node.ModerationProfile,undefined);}
 assert.match(nodes[1].actionDescription,/Writer \(alice\)$/);
});
test('delete author lookup failure aborts resolver',async()=>{
 const {context,calls,resolve}=recordingContext({authorFailure:true});
 await assert.rejects(()=>M.deleteComments(resolve,null,{where:{id:'c'}},context,{}),/author failed/);assert.deepEqual(calls,['author']);
});
test('close failure and duplicate-check failure still create both activities with moderator attribution',async()=>{
 const {context,calls,nodes,resolve}=recordingContext({closeFailure:true,checkFailure:true});
 await M.deleteComments(resolve,null,{where:{id:'c'}},context,{});
 assert.deepEqual(calls,['author','resolve','related','close','check','activity:close','activity:delete']);
 assert.equal(nodes[0].ModerationProfile.connect.where.node.displayName,'mod');assert.equal(nodes[0].User,undefined);
});
test('prior delete activity suppresses both activities only after close',async()=>{
 const {context,calls,resolve}=recordingContext({priorDelete:true});await M.deleteComments(resolve,null,{where:{id:'c'}},context,{});
 assert.deepEqual(calls,['author','resolve','related','close','check']);
});
test('no-op author and issue capabilities when neither repositories nor driver are available',async()=>{
 const {context,calls,resolve}=recordingContext();
 delete context.issueActivityMiddlewareRepository;delete context.issueActivityRepository;
 await M.deleteComments(resolve,null,{where:{id:'c'}},context,{});assert.deepEqual(calls,['resolve']);
});
test('records via injected repositories even when OGM is absent',async()=>{
 const {context,calls,resolve}=recordingContext();delete context.ogm;
 await M.deleteComments(resolve,null,{where:{id:'c'}},context,{});
 assert.deepEqual(calls,['author','resolve','related','close','check','activity:close','activity:delete']);
});
test('edit wrappers retain nonempty-update versus custom no-op difference',async()=>{
 const {context,calls,resolve}=recordingContext();
 await M.updateEvents(resolve,null,{where:{id:'e'},update:{}},context,{});assert.deepEqual(calls,['resolve']);calls.length=0;
 await M.updateEvents(async()=>{calls.push('resolve');return undefined;},null,{where:{id:'e'},update:{title:'x'}},context,{});assert.deepEqual(calls,['resolve','related','activity:edit']);calls.length=0;
 await M.updateEventWithChannelConnections(resolve,null,{where:{id:'e'}},context,{});assert.deepEqual(calls,['resolve','related','activity:edit']);
});

test('actual delete wrapper suppresses close notification and continues after close write and delete notify failures',async()=>{
 const {buildSchema}=await import('graphql');
 const {registerGeneratedSchema}=await import('../services/persistence/generatedSchemaOperations.js');
 const {context,calls,resolve}=recordingContext();context.driver={};
 const schema=buildSchema('input IDWhere {eq:ID} input IssueWhere {id:IDWhere} type Email {address:String} type User {username:String notifyOnSubscribedIssueUpdates:Boolean Email:Email} type Issue {id:ID issueNumber:Int title:String channelUniqueName:String SubscribedToNotifications:[User]} type Query {issues(where:IssueWhere):[Issue]}');
 schema.getQueryType()!.getFields().issues.resolve=()=>{calls.push('notify');throw Error('notify failed');};registerGeneratedSchema(context.driver,schema);
 let failClose=false;
 context.issueActivityRepository.appendActivity=async(_id:string,node:any)=>{calls.push(`activity:${node.actionType}`);if(failClose&&node.actionType==='close')throw Error('close activity failed');};
 for(const fails of [false,true]){
  calls.length=0;failClose=fails;
  const result=await M.deleteComments(resolve,null,{where:{id:'c'}},context,{});
  assert.deepEqual(result,{nodesDeleted:1});
  assert.deepEqual(calls,['author','resolve','related','close','check','activity:close','activity:delete','notify']);
 }
 calls.length=0;
 const result=await M.updateEvents(resolve,null,{where:{id:'e'},update:{title:'new'}},context,{});
 assert.deepEqual(result,{nodesDeleted:1});assert.deepEqual(calls,['resolve','related','activity:edit','notify']);
});
