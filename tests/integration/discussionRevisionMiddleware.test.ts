import middleware from "../../middleware/discussionVersionHistoryMiddleware.js";
import {createDiscussionPluginPipelineMiddleware} from "../../middleware/discussionPluginPipelineMiddleware.js";
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema,executeGeneratedOperation} from '../../services/persistence/generatedSchemaOperations.js';
import {createDiscussionRevisionRepository} from '../../services/persistence/discussionRevisionRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let repository: ReturnType<typeof createDiscussionRevisionRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});
 const schema=await neoSchema.getSchema();registerGeneratedSchema(driver,schema);
 repository=createDiscussionRevisionRepository(driver);
 for(const kind of ['create','update','create_relationship']) engine.events.on(kind,(event:Record<string,unknown>)=>events.push({kind,event}));
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);events=[];});
const outcome=async(call:()=>Promise<unknown>)=>call().then(()=>null,(e:Error)=>e.message);

const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
async function seed(invalid=false){await driver.executeQuery(`CREATE (a:User {username:'author',createdAt:datetime()}) CREATE (u:User {username:'editor',createdAt:datetime()}) CREATE (p:User {username:'prior',createdAt:datetime()}) CREATE (d:Discussion {id:'d',${invalid?'':"title:'Old',"}body:'Body',createdAt:datetime()}) CREATE (a)-[:POSTED_DISCUSSION]->(d) CREATE (d)-[:BODY_LAST_EDITED_BY]->(p)`);}
async function state(){const result=await driver.executeQuery(`MATCH (v:TextVersion) OPTIONAL MATCH (v)<-[:AUTHORED_VERSION]-(u:User) RETURN v.body AS body,u.username AS author ORDER BY body`);const discussion=await driver.executeQuery(`MATCH (d:Discussion {id:'d'}) RETURN properties(d) AS p, [(d)-[:HAS_TITLE_VERSION]->(v) | v.body] AS titles, [(d)-[:HAS_BODY_VERSION]->(v) | v.body] AS bodies, [(d)-[:BODY_LAST_EDITED_BY]->(u) | u.username] AS editors`);return {links:discussion.records.map(r=>({titles:r.get('titles'),bodies:r.get('bodies'),editors:r.get('editors')})),revisions:result.records.map(r=>({body:r.get('body'),author:r.get('author')})),touched:discussion.records.length?Boolean(discussion.records[0].get('p').ageGateTouchedAt):false};}
function eventShape(){return events.map(({kind,event})=>({kind,typename:event.typename,from:event.fromTypename,to:event.toTypename,relationship:event.relationshipName}));}

test('custom mention snapshot preserves distinct selection and missing rows',async(t)=>{
 await seed();for(const id of ['d','absent'])t.assert.snapshot(plain(await repository.findMentionSnapshot(id)));
});
for(const [name,update,custom] of [['title',{title:'New'},false],['body',{body:'New'},false],['both',{title:'New',body:'New'},false],['equal',{title:'Old',body:'Body'},false],['custom',{title:'New',body:'New'},true]] as const)test(`actual discussion middleware preserves history/notification/event behavior: ${name}`,async(t)=>{
 await resetDatabase(driver);await seed();events=[];
 await driver.executeQuery("MATCH (d:Discussion {id:'d'}) CREATE (dc:DiscussionChannel {id:'dc',channelUniqueName:'cats'}) CREATE (dc)-[:POSTED_IN_CHANNEL]->(d)");
 const notifications:unknown[]=[];
 const repo=repository;
 const context:any={driver,user:{username:'editor'},discussionRevisionRepository:repo,issueActivityRepository:{findRelatedIssueIds:async()=>[],appendActivity:async()=>{}},notificationWriter:{createForUser:async(input:unknown)=>{notifications.push(input);return true;}}};
 // resolve() is the generated-mutation executor that the middleware wraps; it is the same for
 // every path (not an oracle comparison), so it is left as the write mechanism under test.
 const resolve=async()=>executeGeneratedOperation(driver,'mutation($where:DiscussionWhere!,$update:DiscussionUpdateInput!){updateDiscussions(where:$where,update:$update){discussions{id}}}',{where:{id:'d'},update});
 const m:any=middleware.Mutation;
 await (custom?m.updateDiscussionWithChannelConnections(resolve,null,{where:{id:'d'},discussionUpdateInput:update},context,{}):m.updateDiscussions(resolve,null,{where:{id:'d'},update},context,{}));
 const out:any={state:await state(),events:eventShape(),notifications};
 assert.equal(out.state.revisions.length,name==='both'?2:name==='equal'||custom?0:1);
 assert.equal(out.notifications.length,custom?0:1);
 t.assert.snapshot(out);
});

test('discussion edit plugin middleware dispatches to final channel membership',async()=>{
 await seed();
 await driver.executeQuery("MATCH (d:Discussion {id:'d'}) CREATE (old:DiscussionChannel {id:'old',channelUniqueName:'old-forum'}) CREATE (old)-[:POSTED_IN_CHANNEL]->(d)");
 const calls:Array<{discussionId:string;channelUniqueName:string;event:string}>=[];
 const pluginMiddleware=createDiscussionPluginPipelineMiddleware(async({discussionId,channelUniqueName,event})=>{
  calls.push({discussionId,channelUniqueName,event});
  return [];
 }).Mutation;
 const resolve=async()=>{
  await driver.executeQuery("MATCH (d:Discussion {id:'d'}) OPTIONAL MATCH (old:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(d) DETACH DELETE old SET d.body='Edited body' CREATE (next:DiscussionChannel {id:'next',channelUniqueName:'new-forum'}) CREATE (next)-[:POSTED_IN_CHANNEL]->(d)");
  return {id:'d'};
 };

 const result=await pluginMiddleware.updateDiscussionWithChannelConnections(
  resolve,
  null,
  {where:{id:'d'},discussionUpdateInput:{body:'Edited body'}},
  {driver,discussionRevisionRepository:repository} as any,
  {} as any
 );

 assert.deepEqual(result,{id:'d'});
 assert.deepEqual(calls,[{discussionId:'d',channelUniqueName:'new-forum',event:'discussionChannel.edited'}]);
});
