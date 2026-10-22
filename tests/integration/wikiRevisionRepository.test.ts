import {wikiPageVersionHistoryHandler} from "../../hooks/wikiPageVersionHistoryHook.js";
import middleware from "../../middleware/wikiPageVersionHistoryMiddleware.js";
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import { createWikiRevisionRepository } from '../../services/persistence/wikiRevisionRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>['ogm'];
let repository: ReturnType<typeof createWikiRevisionRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);ogm=app.ogm;
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neoSchema.getSchema();initializeOgmFromExistingSchema(ogm,neoSchema,schema);registerGeneratedSchema(driver,schema);
 repository=createWikiRevisionRepository(driver);
 for(const kind of ['create','update','create_relationship']) engine.events.on(kind,(event:Record<string,unknown>)=>events.push({kind,event}));
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);events=[];});

const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
function baseline(){const w=ogm.model('WikiPage'),v=ogm.model('TextVersion'),u=ogm.model('User');return {
 findSnapshot:(id:string)=>w.find({where:{id},selectionSet:'{id title body editReason VersionAuthor {username} PastVersions {id body createdAt}}'}),
 findAuthor:(username:string)=>u.find({where:{username},selectionSet:'{username}'}),
 createRevision:(input:any)=>v.create({input:[input]}),
 findPageId:(id:string)=>w.find({where:{id},selectionSet:'{id}'}),
 connectRevision:async(id:string,revisionId:string)=>{await w.update({where:{id},update:{PastVersions:{connect:[{where:{node:{id:revisionId}}}]}} as any});},
};}
async function seed(invalid=false){await driver.executeQuery(`CREATE (u:User {username:'previous',createdAt:datetime()}) CREATE (:User {username:'system',createdAt:datetime()}) CREATE (w:WikiPage {id:'w',title:'Title',body:'Body',editReason:'old reason',${invalid?'':"slug:'page',channelUniqueName:'cats',"}createdAt:datetime()}) CREATE (u)-[:AUTHORED_VERSION]->(w)`);}
async function state(){const r=await driver.executeQuery(`MATCH (v:TextVersion) OPTIONAL MATCH (v)<-[:AUTHORED_VERSION]-(u:User) OPTIONAL MATCH (w:WikiPage)-[:HAS_VERSION]->(v) RETURN v.body AS body,v.editReason AS reason,u.username AS author,w.id AS parent ORDER BY body`);return r.records.map(x=>({body:x.get('body'),reason:x.get('reason'),author:x.get('author'),parent:x.get('parent')}));}
function eventShape(){return events.map(({kind,event})=>({kind,typename:event.typename,from:event.fromTypename,to:event.toTypename,relationship:event.relationshipName}));}
test('wiki snapshots and author lookup retain exact projections and missing behavior',async()=>{
 await seed();for(const id of ['w','absent']){assert.deepEqual(plain(await repository.findSnapshot(id)),plain(await baseline().findSnapshot(id)));assert.deepEqual(plain(await repository.findPageId(id)),plain(await baseline().findPageId(id)));}
 assert.deepEqual(plain(await repository.findAuthor('previous')),plain(await baseline().findAuthor('previous')));
});
for(const [name,update,invalid] of [['title',{title:'New'},false],['body',{body:'New'},false],['both',{title:'New',body:'New'},false],['unchanged',{title:'Title',body:'Body'},false],['invalid default',{title:'New',body:'New'},true]] as const)test(`actual wiki revision hook graph and event parity: ${name}`,async()=>{
 const outputs:unknown[]=[];
 for(const repo of [baseline(),repository]){await resetDatabase(driver);await seed(invalid);events=[];await wikiPageVersionHistoryHandler({context:{driver,wikiRevisionRepository:repo} as any,params:{where:{id:'w'},update}});outputs.push({graph:await state(),events:eventShape()});}
 assert.deepEqual(outputs[1],outputs[0]);assert.equal((outputs[1] as any).graph.length,name==='unchanged'?0:name==='both'||invalid?2:1);
});
test('orphan revision persists when parent disappears after snapshot',async()=>{
 const results:unknown[]=[];
 for(const inner of [baseline(),repository]){await resetDatabase(driver);await seed();const repo={...inner,findSnapshot:async(id:string)=>{const rows=await inner.findSnapshot(id);await driver.executeQuery("MATCH (w:WikiPage) DETACH DELETE w");return rows;}};await wikiPageVersionHistoryHandler({context:{driver,wikiRevisionRepository:repo} as any,params:{where:{id:'w'},update:{title:'New'}}});results.push(await state());}
 assert.deepEqual(results[1],results[0]);assert.equal((results[1] as any[])[0].parent,null);
});
for(const nested of [true,false])test(`actual child middleware preserves result-shape contract and system author (nested=${nested})`,async()=>{
 const outputs:unknown[]=[];
 for(const repo of [baseline(),repository]){await resetDatabase(driver);await seed();events=[];const result={wikiPages:[{ChildPages:[{id:'w',title:'Child title',body:'Child body',editReason:'new'}]}]};const output=nested?{updateWikiPages:result}:result;
 const returned=await (middleware.Mutation.updateWikiPages as any)(async()=>output,null,{update:{ChildPages:{create:[]},title:'ignored'}},{driver,wikiRevisionRepository:repo,user:{username:'not-system'}},{});assert.equal(returned,output);outputs.push({graph:await state(),events:eventShape()});}
 assert.deepEqual(outputs[1],outputs[0]);const graph=(outputs[1] as any).graph;assert.equal(graph.length,nested?2:0);for(const row of graph)assert.equal(row.author,'system');
});
