import middleware from "../../middleware/issueActivityFeedMiddleware.js";
import {createIssueActivityMiddlewareRepository} from "../../services/persistence/issueActivityMiddlewareRepository.js";
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../../customResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createIssueActivityRepository} from '../../services/persistence/issueActivityRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>['ogm'];
let repository: ReturnType<typeof createIssueActivityRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);ogm=app.ogm;
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neoSchema.getSchema();initializeOgmFromExistingSchema(ogm,neoSchema,schema);registerGeneratedSchema(driver,schema);
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
test('all author snapshots preserve generated selections, union authors and missing rows',async()=>{
 await driver.executeQuery(`CREATE (u:User {username:'u',displayName:'User',createdAt:datetime()}) CREATE (m:ModerationProfile {displayName:'Mod'}) CREATE (c:Comment {id:'c',isRootComment:true,createdAt:datetime()}) CREATE (c)<-[:AUTHORED_COMMENT]-(u) CREATE (d:Discussion {id:'d',title:'Title',createdAt:datetime()}) CREATE (d)<-[:POSTED_DISCUSSION]-(u) CREATE (e:Event {id:'e',title:'Event',createdAt:datetime()}) CREATE (e)<-[:POSTED_BY]-(u)`);
 const repo=createIssueActivityMiddlewareRepository(driver);
 assert.equal((await repo.findCommentAuthor('c'))[0].CommentAuthor?.username,'u');
 assert.equal((await repo.findEventAuthor('e'))[0].Poster?.username,'u');
 for(const id of ['c','absent'])assert.deepEqual(plain(await repo.findCommentAuthor(id)),plain(await ogm.model('Comment').find({where:{id},selectionSet:'{ id CommentAuthor { ... on User { username displayName } ... on ModerationProfile { displayName } } }'})));
 assert.deepEqual(plain(await repo.findDiscussionAuthor('d')),plain(await ogm.model('Discussion').find({where:{id:'d'},selectionSet:'{ id Author { username displayName } }'})));
 assert.deepEqual(plain(await repo.findEventAuthor('e')),plain(await ogm.model('Event').find({where:{id:'e'},selectionSet:'{ id Poster { username displayName } }'})));
 await driver.executeQuery(`MATCH (c:Comment {id:'c'})<-[r:AUTHORED_COMMENT]-(:User), (m:ModerationProfile {displayName:'Mod'}) DELETE r CREATE (c)<-[:AUTHORED_COMMENT]-(m)`);
 assert.equal((await repo.findCommentAuthor('c'))[0].CommentAuthor?.displayName,'Mod');
 assert.deepEqual(plain(await repo.findCommentAuthor('c')),plain(await ogm.model('Comment').find({where:{id:'c'},selectionSet:'{ id CommentAuthor { ... on User { username displayName } ... on ModerationProfile { displayName } } }'})));
});
for(const valid of [true,false])test(`closure mutation preserves default projection, persistence and events (valid=${valid})`,async()=>{
 await seed(valid);const repo=createIssueActivityMiddlewareRepository(driver);
 const old=await outcome(()=>ogm.model('Issue').update({where:{id:'i'},update:{isOpen:false}}));const oldEvents=eventShape();
 await resetDatabase(driver);events=[];await seed(valid);
 assert.equal(await outcome(()=>repo.closeDeletedIssue('i')),old);assert.deepEqual(eventShape(),oldEvents);
 const result=await driver.executeQuery("MATCH (i:Issue {id:'i'}) RETURN i.isOpen AS open");assert.equal(result.records[0].get('open'),false);
});
test('duplicate delete query matches legacy filter and missing issue',async()=>{
 await seed();const repo=createIssueActivityMiddlewareRepository(driver);
 for(const id of ['i','absent'])assert.deepEqual(plain(await repo.findDeleteActivities(id)),plain(await ogm.model('Issue').find({where:{id,ActivityFeed_SOME:{actionType:'delete'}},selectionSet:'{id}'})));
 await repository.appendActivity('i',{...node,actionType:'delete'});
 assert.deepEqual(plain(await repo.findDeleteActivities('i')),[{id:'i'}]);
});
for(const kind of ['Comments','Discussions','Events'])test(`actual delete${kind} middleware closes issue and creates exactly close/delete activities`,async()=>{
 await seed();const singular=kind==='Comments'?'Comment':kind==='Discussions'?'Discussion':'Event';
 const legacy=kind==='Comments'?'relatedCommentId':kind==='Discussions'?'relatedDiscussionId':'relatedEventId';
 await driver.executeQuery(`MATCH (i:Issue {id:'i'}) SET i.${legacy}='content' CREATE (:${singular} {id:'content',title:'Title',text:'Text',isRootComment:true,createdAt:datetime()})`);
 await driver.executeQuery("MATCH (i:Issue {id:'i'}) CREATE (sub:User {username:'sub',createdAt:datetime()}) CREATE (i)<-[:SUBSCRIBED_TO_ISSUE]-(sub)");
 events=[];
 const context:any={ogm,driver,user:{username:'u'}};const m:any=middleware.Mutation;
 await m[`delete${kind}`](async()=>ogm.model(singular as 'Comment').delete({where:{id:'content'}}),null,{where:{id:'content'}},context,{});
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
