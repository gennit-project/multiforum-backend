import middleware from "../../middleware/discussionVersionHistoryMiddleware.js";
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../../customResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createDiscussionRevisionRepository} from '../../services/persistence/discussionRevisionRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>['ogm'];
let repository: ReturnType<typeof createDiscussionRevisionRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);ogm=app.ogm;
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neoSchema.getSchema();initializeOgmFromExistingSchema(ogm,neoSchema,schema);registerGeneratedSchema(driver,schema);
 repository=createDiscussionRevisionRepository(driver);
 for(const kind of ['create','update','create_relationship']) engine.events.on(kind,(event:Record<string,unknown>)=>events.push({kind,event}));
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);events=[];});
const outcome=async(call:()=>Promise<unknown>)=>call().then(()=>null,(e:Error)=>e.message);

const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const SNAPSHOT='{id title body Author {username} BodyLastEditedBy {username} DiscussionChannels {channelUniqueName} PastTitleVersions {id body createdAt} PastBodyVersions {id body createdAt}}';
function baseline(){const d=ogm.model('Discussion'),v=ogm.model('TextVersion'),u=ogm.model('User');return {
 findSnapshot:(id:string)=>d.find({where:{id},selectionSet:SNAPSHOT}),
 findAuthor:(username:string)=>u.find({where:{username},selectionSet:'{username}'}),
 createRevision:(body:string,username:string)=>v.create({input:[{body,Author:{connect:{where:{node:{username}}}}}]}),
 findDiscussionId:(id:string)=>d.find({where:{id},selectionSet:'{id}'}),
 connectTitleRevision:async(id:string,revisionId:string)=>{await d.update({where:{id},update:{PastTitleVersions:{connect:[{where:{node:{id:revisionId}}}]}} as any});},
 connectBodyRevision:async(id:string,revisionId:string)=>{await d.update({where:{id},update:{PastBodyVersions:{connect:[{where:{node:{id:revisionId}}}]}} as any});},
 setBodyEditor:async(id:string,username:string)=>{await d.update({where:{id},update:{BodyLastEditedBy:{disconnect:{},connect:{where:{node:{username}}}}}});},
};}
async function seed(invalid=false){await driver.executeQuery(`CREATE (a:User {username:'author',createdAt:datetime()}) CREATE (u:User {username:'editor',createdAt:datetime()}) CREATE (p:User {username:'prior',createdAt:datetime()}) CREATE (d:Discussion {id:'d',${invalid?'':"title:'Old',"}body:'Body',createdAt:datetime()}) CREATE (a)-[:POSTED_DISCUSSION]->(d) CREATE (d)-[:BODY_LAST_EDITED_BY]->(p)`);}
async function state(){const result=await driver.executeQuery(`MATCH (v:TextVersion) OPTIONAL MATCH (v)<-[:AUTHORED_VERSION]-(u:User) RETURN v.body AS body,u.username AS author ORDER BY body`);const discussion=await driver.executeQuery(`MATCH (d:Discussion {id:'d'}) RETURN properties(d) AS p, [(d)-[:HAS_TITLE_VERSION]->(v) | v.body] AS titles, [(d)-[:HAS_BODY_VERSION]->(v) | v.body] AS bodies, [(d)-[:BODY_LAST_EDITED_BY]->(u) | u.username] AS editors`);return {links:discussion.records.map(r=>({titles:r.get('titles'),bodies:r.get('bodies'),editors:r.get('editors')})),revisions:result.records.map(r=>({body:r.get('body'),author:r.get('author')})),touched:discussion.records.length?Boolean(discussion.records[0].get('p').ageGateTouchedAt):false};}
function eventShape(){return events.map(({kind,event})=>({kind,typename:event.typename,from:event.fromTypename,to:event.toTypename,relationship:event.relationshipName}));}

test('custom mention snapshot preserves distinct selection and missing rows',async()=>{
 await seed();for(const id of ['d','absent'])assert.deepEqual(plain(await repository.findMentionSnapshot(id)),plain(await ogm.model('Discussion').find({where:{id},selectionSet:'{id title body Author {username displayName} DiscussionChannels {channelUniqueName}}'})));
});
for(const [name,update,custom] of [['title',{title:'New'},false],['body',{body:'New'},false],['both',{title:'New',body:'New'},false],['equal',{title:'Old',body:'Body'},false],['custom',{title:'New',body:'New'},true]] as const)test(`actual discussion middleware preserves history/notification/event behavior: ${name}`,async()=>{
 const outputs:unknown[]=[];
 for(const old of [true,false]){
  await resetDatabase(driver);await seed();events=[];
  await driver.executeQuery("MATCH (d:Discussion {id:'d'}) CREATE (dc:DiscussionChannel {id:'dc',channelUniqueName:'cats'}) CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)");
  const notifications:unknown[]=[];
  const repo=old?{...repository,findSnapshot:baseline().findSnapshot,findMentionSnapshot:(id:string)=>ogm.model('Discussion').find({where:{id},selectionSet:'{id title body Author {username displayName} DiscussionChannels {channelUniqueName}}'})}:repository;
  const context:any={driver,user:{username:'editor'},discussionRevisionRepository:repo,issueActivityRepository:{findRelatedIssueIds:async()=>[],appendActivity:async()=>{}},notificationWriter:{createForUser:async(input:unknown)=>{notifications.push(input);return true;}}};
  const resolve=async()=>ogm.model('Discussion').update({where:{id:'d'},update});
  const m:any=middleware.Mutation;
  await (custom?m.updateDiscussionWithChannelConnections(resolve,null,{where:{id:'d'},discussionUpdateInput:update},context,{}):m.updateDiscussions(resolve,null,{where:{id:'d'},update},context,{}));
  outputs.push({state:await state(),events:eventShape(),notifications});
 }
 assert.deepEqual(outputs[1],outputs[0]);const out=outputs[1] as any;
 assert.equal(out.state.revisions.length,name==='both'?2:name==='equal'||custom?0:1);
 assert.equal(out.notifications.length,custom?0:1);
});
