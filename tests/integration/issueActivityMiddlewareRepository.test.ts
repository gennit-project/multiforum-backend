import middleware from "../../middleware/issueActivityFeedMiddleware.js";
import {createIssueActivityMiddlewareRepository} from "../../services/persistence/issueActivityMiddlewareRepository.js";
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema,executeGeneratedOperation} from '../../services/persistence/generatedSchemaOperations.js';
import {createIssueActivityRepository} from '../../services/persistence/issueActivityRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let repository: ReturnType<typeof createIssueActivityRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neoSchema.getSchema();registerGeneratedSchema(driver,schema);
 repository=createIssueActivityRepository(driver);
 for(const kind of ['create','update','delete','create_relationship']) engine.events.on(kind,(event:Record<string,unknown>)=>events.push({kind,event}));
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);events=[];});
const outcome=async(call:()=>Promise<unknown>)=>call().then(()=>null,(e:Error)=>e.message);
const node={actionDescription:'edited',actionType:'edit',User:{connect:{where:{node:{username:'u'}}}}};
async function seed(issueNumber=true){await driver.executeQuery(`CREATE (:User {username:'u',createdAt:datetime()}) CREATE (:Issue {id:'i',${issueNumber?'issueNumber:1,':''}isOpen:true,createdAt:datetime()})`);}
async function state(){const r=await driver.executeQuery(`MATCH (i:Issue {id:'i'}) OPTIONAL MATCH (i)-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction) RETURN count(a) AS n`);return r.records[0].get('n').toNumber();}
function eventShape(){return events.map(({kind,event})=>({kind,typename:event.typename,properties:Object.keys(event).sort()}));}


const plain=(v:unknown)=>JSON.parse(JSON.stringify(v));
test('all author snapshots preserve generated selections, union authors and missing rows',async(t)=>{
 await driver.executeQuery(`CREATE (u:User {username:'u',displayName:'User',createdAt:datetime()}) CREATE (m:ModerationProfile {displayName:'Mod'}) CREATE (c:Comment {id:'c',isRootComment:true,createdAt:datetime()}) CREATE (c)<-[:AUTHORED_COMMENT]-(u) CREATE (d:Discussion {id:'d',title:'Title',createdAt:datetime()}) CREATE (d)<-[:POSTED_DISCUSSION]-(u) CREATE (e:Event {id:'e',title:'Event',createdAt:datetime()}) CREATE (e)<-[:POSTED_BY]-(u)`);
 const repo=createIssueActivityMiddlewareRepository(driver);
 assert.equal((await repo.findCommentAuthor('c'))[0].CommentAuthor?.username,'u');
 assert.equal((await repo.findEventAuthor('e'))[0].Poster?.username,'u');
 for(const id of ['c','absent'])t.assert.snapshot(plain(await repo.findCommentAuthor(id)));
 t.assert.snapshot(plain(await repo.findDiscussionAuthor('d')));
 t.assert.snapshot(plain(await repo.findEventAuthor('e')));
 await driver.executeQuery(`MATCH (c:Comment {id:'c'})<-[r:AUTHORED_COMMENT]-(:User), (m:ModerationProfile {displayName:'Mod'}) DELETE r CREATE (c)<-[:AUTHORED_COMMENT]-(m)`);
 assert.equal((await repo.findCommentAuthor('c'))[0].CommentAuthor?.displayName,'Mod');
 t.assert.snapshot(plain(await repo.findCommentAuthor('c')));
});
for(const valid of [true,false])test(`closure mutation preserves default projection, persistence and events (valid=${valid})`,async(t)=>{
 await seed(valid);events=[];const repo=createIssueActivityMiddlewareRepository(driver);
 const result=await outcome(()=>repo.closeDeletedIssue('i'));
 t.assert.snapshot({result,events:eventShape()});
 const row=await driver.executeQuery("MATCH (i:Issue {id:'i'}) RETURN i.isOpen AS open");assert.equal(row.records[0].get('open'),false);
});
test('duplicate delete query matches legacy filter and missing issue',async(t)=>{
 await seed();const repo=createIssueActivityMiddlewareRepository(driver);
 for(const id of ['i','absent'])t.assert.snapshot(plain(await repo.findDeleteActivities(id)));
 await repository.appendActivity('i',{...node,actionType:'delete'});
 assert.deepEqual(plain(await repo.findDeleteActivities('i')),[{id:'i'}]);
});
for(const kind of ['Comments','Discussions','Events'])test(`actual delete${kind} middleware closes issue and creates exactly close/delete activities`,async()=>{
 await seed();const singular=kind==='Comments'?'Comment':kind==='Discussions'?'Discussion':'Event';
 const legacy=kind==='Comments'?'relatedCommentId':kind==='Discussions'?'relatedDiscussionId':'relatedEventId';
 await driver.executeQuery(`MATCH (i:Issue {id:'i'}) SET i.${legacy}='content' CREATE (:${singular} {id:'content',title:'Title',text:'Text',isRootComment:true,createdAt:datetime()})`);
 await driver.executeQuery("MATCH (i:Issue {id:'i'}) CREATE (sub:User {username:'sub',createdAt:datetime()}) CREATE (i)<-[:SUBSCRIBED_TO_ISSUE]-(sub)");
 events=[];
 const context:any={driver,user:{username:'u'}};const m:any=middleware.Mutation;
 const runDelete=async()=>(await executeGeneratedOperation<Record<string,{nodesDeleted:number}>>(driver,`mutation($where:${singular}Where){delete${kind}(where:$where){nodesDeleted relationshipsDeleted}}`,{where:{id:'content'}}))[`delete${kind}`];
 await m[`delete${kind}`](runDelete,null,{where:{id:'content'}},context,{});
 const result=await driver.executeQuery("MATCH (i:Issue {id:'i'})-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction) RETURN i.isOpen AS open, collect(a.actionType) AS actions");
 assert.equal(result.records[0].get('open'),false);assert.deepEqual(result.records[0].get('actions').sort(),['close','delete']);
 const deletion=events.findIndex(x=>x.kind==='delete'&&x.event.typename===singular);
 const closure=events.findIndex(x=>x.kind==='update'&&x.event.typename==='Issue');
 const activity=events.findIndex(x=>x.kind==='create'&&x.event.typename==='ModerationAction');
 assert.ok(deletion>=0&&closure>deletion&&activity>closure,JSON.stringify(eventShape()));
 // A repeated successful deletion signal retains the pre-existing duplicate guard.
 await m[`delete${kind}`](async()=>({nodesDeleted:1}),null,{where:{id:'content'}},context,{});assert.equal(await state(),2);
 const notifications=await driver.executeQuery('MATCH (n:Notification) RETURN count(n) AS n');assert.equal(notifications.records[0].get('n').toNumber(),1);
});
