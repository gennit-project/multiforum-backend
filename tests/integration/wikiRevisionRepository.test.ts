import {wikiPageVersionHistoryHandler} from "../../hooks/wikiPageVersionHistoryHook.js";
import middleware from "../../middleware/wikiPageVersionHistoryMiddleware.js";
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import { createWikiRevisionRepository } from '../../services/persistence/wikiRevisionRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let repository: ReturnType<typeof createWikiRevisionRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neoSchema.getSchema();registerGeneratedSchema(driver,schema);
 repository=createWikiRevisionRepository(driver);
 for(const kind of ['create','update','create_relationship']) engine.events.on(kind,(event:Record<string,unknown>)=>events.push({kind,event}));
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);events=[];});

const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
async function seed(invalid=false){await driver.executeQuery(`CREATE (u:User {username:'previous',createdAt:datetime()}) CREATE (:User {username:'system',createdAt:datetime()}) CREATE (w:WikiPage {id:'w',title:'Title',body:'Body',editReason:'old reason',${invalid?'':"slug:'page',channelUniqueName:'cats',"}createdAt:datetime()}) CREATE (u)-[:AUTHORED_VERSION]->(w)`);}
async function state(){const r=await driver.executeQuery(`MATCH (v:TextVersion) OPTIONAL MATCH (v)<-[:AUTHORED_VERSION]-(u:User) OPTIONAL MATCH (w:WikiPage)-[:HAS_VERSION]->(v) RETURN v.body AS body,v.editReason AS reason,u.username AS author,w.id AS parent ORDER BY body`);return r.records.map(x=>({body:x.get('body'),reason:x.get('reason'),author:x.get('author'),parent:x.get('parent')}));}
function eventShape(){return events.map(({kind,event})=>({kind,typename:event.typename,from:event.fromTypename,to:event.toTypename,relationship:event.relationshipName}));}
test('wiki snapshots and author lookup retain exact projections and missing behavior',async(t)=>{
 await seed();for(const id of ['w','absent']){t.assert.snapshot(plain(await repository.findSnapshot(id)));t.assert.snapshot(plain(await repository.findPageId(id)));}
 t.assert.snapshot(plain(await repository.findAuthor('previous')));
});
for(const [name,update,invalid] of [['title',{title:'New'},false],['body',{body:'New'},false],['both',{title:'New',body:'New'},false],['unchanged',{title:'Title',body:'Body'},false],['invalid default',{title:'New',body:'New'},true]] as const)test(`actual wiki revision hook graph and event parity: ${name}`,async(t)=>{
 await resetDatabase(driver);await seed(invalid);events=[];await wikiPageVersionHistoryHandler({context:{driver,wikiRevisionRepository:repository} as any,params:{where:{id:'w'},update}});const captured={graph:await state(),events:eventShape()};
 assert.equal(captured.graph.length,name==='unchanged'?0:name==='both'||invalid?2:1);
 t.assert.snapshot(captured);
});
test('orphan revision persists when parent disappears after snapshot',async(t)=>{
 await resetDatabase(driver);await seed();const repo={...repository,findSnapshot:async(id:string)=>{const rows=await repository.findSnapshot(id);await driver.executeQuery("MATCH (w:WikiPage) DETACH DELETE w");return rows;}};await wikiPageVersionHistoryHandler({context:{driver,wikiRevisionRepository:repo} as any,params:{where:{id:'w'},update:{title:'New'}}});const result=await state();
 assert.equal((result as any[])[0].parent,null);
 t.assert.snapshot(result);
});
for(const nested of [true,false])test(`actual child middleware preserves result-shape contract and system author (nested=${nested})`,async(t)=>{
 await resetDatabase(driver);await seed();events=[];const result={wikiPages:[{ChildPages:[{id:'w',title:'Child title',body:'Child body',editReason:'new'}]}]};const output=nested?{updateWikiPages:result}:result;
 const returned=await (middleware.Mutation.updateWikiPages as any)(async()=>output,null,{update:{ChildPages:{create:[]},title:'ignored'}},{driver,wikiRevisionRepository:repository,user:{username:'not-system'}},{});assert.equal(returned,output);const captured={graph:await state(),events:eventShape()};
 assert.equal(captured.graph.length,nested?2:0);for(const row of captured.graph)assert.equal(row.author,'system');
 t.assert.snapshot(captured);
});
