import {discussionVersionHistoryHandler} from "../../hooks/discussionVersionHistoryHook.js";
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import { createDiscussionRevisionRepository } from '../../services/persistence/discussionRevisionRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let repository: ReturnType<typeof createDiscussionRevisionRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neoSchema.getSchema();registerGeneratedSchema(driver,schema);
 repository=createDiscussionRevisionRepository(driver);
 for(const kind of ['create','update','create_relationship']) engine.events.on(kind,(event:Record<string,unknown>)=>events.push({kind,event}));
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);events=[];});
const outcome=async(call:()=>Promise<unknown>)=>call().then(()=>null,(e:Error)=>e.message);

const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
// Nested relationship projections (collect()) have no guaranteed cross-run ordering, and the seed stamps
const norm=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,v)=>(['createdAt','updatedAt','timestamp','ageGateTouchedAt'].includes(key)&&v!==null)?'<time>':v));
async function seed(invalid=false){await driver.executeQuery(`CREATE (a:User {username:'author',createdAt:datetime()}) CREATE (u:User {username:'editor',createdAt:datetime()}) CREATE (p:User {username:'prior',createdAt:datetime()}) CREATE (d:Discussion {id:'d',${invalid?'':"title:'Old',"}body:'Body',createdAt:datetime()}) CREATE (a)-[:POSTED_DISCUSSION]->(d) CREATE (d)-[:BODY_LAST_EDITED_BY]->(p)`);}
async function state(){const result=await driver.executeQuery(`MATCH (v:TextVersion) OPTIONAL MATCH (v)<-[:AUTHORED_VERSION]-(u:User) RETURN v.body AS body,u.username AS author ORDER BY body`);const discussion=await driver.executeQuery(`MATCH (d:Discussion {id:'d'}) RETURN properties(d) AS p, [(d)-[:HAS_TITLE_VERSION]->(v) | v.body] AS titles, [(d)-[:HAS_BODY_VERSION]->(v) | v.body] AS bodies, [(d)-[:BODY_LAST_EDITED_BY]->(u) | u.username] AS editors`);return {links:discussion.records.map(r=>({titles:r.get('titles'),bodies:r.get('bodies'),editors:r.get('editors')})),revisions:result.records.map(r=>({body:r.get('body'),author:r.get('author')})),touched:discussion.records.length?Boolean(discussion.records[0].get('p').ageGateTouchedAt):false};}
function eventShape(){return events.map(({kind,event})=>({kind,typename:event.typename,from:event.fromTypename,to:event.toTypename,relationship:event.relationshipName}));}
test('fallback and author snapshots preserve projection and hidden/missing behavior',async(t)=>{
 await seed();for(const id of ['d','absent']){t.assert.snapshot(norm(plain(await repository.findSnapshot(id))));t.assert.snapshot(norm(plain(await repository.findDiscussionId(id))));}
 t.assert.snapshot(norm(plain(await repository.findAuthor('editor'))));
 await driver.executeQuery("MATCH (d:Discussion {id:'d'}) SET d.hasSensitiveContent=true");t.assert.snapshot(norm(plain(await repository.findSnapshot('d'))));
});
for(const [name,update,invalid,missing] of [
 ['title',{title:'New'},false,false],['body',{body:'New'},false,false],['both',{title:'New',body:'New'},false,false],['unchanged',{title:'Old',body:'Body'},false,false],['invalid projection',{title:'New',body:'New'},true,false],['missing parent',{title:'New',body:'New'},false,true],
] as const)test(`actual history handler parity: ${name}`,async(t)=>{
 {
  await resetDatabase(driver);await seed(invalid);events=[];
  if(missing)await driver.executeQuery("MATCH (d:Discussion) DETACH DELETE d");
  const context:any={driver,user:{username:'editor'},discussionRevisionRepository:repository,issueActivityRepository:{findRelatedIssueIds:async()=>[],appendActivity:async()=>{assert.fail('no issue');}}};
  await discussionVersionHistoryHandler({context,params:{where:{id:'d'},update},discussionSnapshot:{id:'d',title:'Old',body:'Body',Author:{username:'author'},BodyLastEditedBy:{username:'prior'}}});
  const output={state:await state(),events:eventShape()};
  if(name==='both'||name==='missing parent')assert.equal(output.state.revisions.length,2);
  t.assert.snapshot(output);
 }
});
test('invalid revision body coercion matches baseline and performs no write',async()=>{
 await seed();await assert.rejects(repository.createRevision(3 as unknown as string,'author'),/String cannot represent a non string value/);assert.deepEqual((await state()).revisions,[]);
});
