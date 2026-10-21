import redactTextVersionRevision from "../../customResolvers/mutations/redactTextVersionRevision.js";
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createRevisionRedactionRepository} from '../../services/persistence/revisionRedactionRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>['ogm'];
let repository: ReturnType<typeof createRevisionRedactionRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);ogm=app.ogm;
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});
 const schema=await neoSchema.getSchema();initializeOgmFromExistingSchema(ogm,neoSchema,schema);registerGeneratedSchema(driver,schema);
 repository=createRevisionRedactionRepository(driver);
 for(const kind of ['create','update','create_relationship']) engine.events.on(kind,(event:Record<string,unknown>)=>events.push({kind,event}));
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);events=[];});
const outcome=async(call:()=>Promise<unknown>)=>call().then(()=>null,(e:Error)=>e.message);

const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
function baseline(){const v=ogm.model('TextVersion');return {
 findRevision:(id:string)=>v.find({where:{id},selectionSet:'{id body editReason createdAt updatedAt Author {username}}'}),
 redactRevision:(id:string)=>v.update({where:{id},update:{body:'[deleted]'},selectionSet:'{textVersions {id body editReason createdAt updatedAt Author {username}}}'}),
};}
const targets=[['comment','Comment','HAS_VERSION','AUTHORED_COMMENT'],['discussion body','Discussion','HAS_BODY_VERSION','POSTED_DISCUSSION'],['wiki','WikiPage','HAS_VERSION','AUTHORED_WIKI_PAGE'],['event description','Event','HAS_DESCRIPTION_VERSION','POSTED_BY']] as const;
async function seed(kind:typeof targets[number]=targets[0]){await driver.executeQuery(`CREATE (u:User {username:'owner',createdAt:datetime()}) CREATE (p:${kind[1]} {id:'parent',title:'Title',text:'Text',isRootComment:true,createdAt:datetime()}) CREATE (u)-[:${kind[3]}]->(p) CREATE (v:TextVersion {id:'v',body:'Original',editReason:'Reason',createdAt:datetime()}) CREATE (p)-[:${kind[2]}]->(v) CREATE (u)-[:AUTHORED_VERSION]->(v)`);}
function eventShape(){return events.map(({kind,event})=>({kind,typename:event.typename,relationship:event.relationshipName}));}
test('revision snapshot matches exact selected fields, hidden/missing rows and ID coercion',async()=>{
 await seed();for(const id of ['v','absent'])assert.deepEqual(plain(await repository.findRevision(id)),plain(await baseline().findRevision(id)));
 await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) SET v.ageGateRestricted=true");assert.deepEqual(await repository.findRevision('v'),[]);assert.deepEqual(await baseline().findRevision('v'),[]);
 assert.equal(await outcome(()=>repository.findRevision({} as any)),await outcome(()=>baseline().findRevision({} as any)));
});
for(const kind of targets)test(`actual redaction resolver parity: ${kind[0]}, authorized no-op still checks permissions`,async()=>{
 const outputs:unknown[]=[];
 for(const repo of [baseline(),repository]){await resetDatabase(driver);await seed(kind);events=[];
 const resolver=redactTextVersionRevision({driver,revisionType:kind[0],revisionRedactionRepository:repo,checkModPermissions:(async()=>false) as any,getServerMembership:async()=>({isServerAdmin:false,isServerModerator:false}) as any});
 const result=await resolver(null,{textVersionId:'v'},{user:{username:'owner'}} as any,{} as any);assert.equal(result.body,'[deleted]');
 const count=events.length;const again=await resolver(null,{textVersionId:'v'},{user:{username:'owner'}} as any,{} as any);assert.equal(again.body,'[deleted]');assert.equal(events.length,count);
 await assert.rejects(()=>resolver(null,{textVersionId:'v'},{user:{username:'outsider'}} as any,{} as any),/No channel specified|permission/);
 const stored=await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) RETURN v.body AS body, v.ageGateTouchedAt IS NOT NULL AS touched");outputs.push({body:stored.records[0].get('body'),touched:stored.records[0].get('touched'),events:eventShape()});
 }
 assert.deepEqual(outputs[1],outputs[0]);assert.ok((outputs[1] as any).events.length>0);
});
test('hidden revision fails before target authentication',async()=>{
 await seed();await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) SET v.ageGateRestricted=true");let auth=0;
 const resolver=redactTextVersionRevision({driver,revisionType:'comment',getUserData:async()=>{auth++;throw Error('unexpected auth');}});
 await assert.rejects(()=>resolver(null,{textVersionId:'v'},{} as any,{} as any),/comment revision not found/);assert.equal(auth,0);
});
test('post-read invalid temporal value preserves baseline transaction failure boundary',async()=>{
 const results:unknown[]=[];
 for(const inner of [baseline(),repository]){await resetDatabase(driver);await seed();events=[];
 const repo={...inner,findRevision:async(id:string)=>{const rows=await inner.findRevision(id);await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) SET v.createdAt='invalid' ");return rows;}};
 const resolver=redactTextVersionRevision({driver,revisionType:'comment',revisionRedactionRepository:repo});
 const error=await outcome(()=>resolver(null,{textVersionId:'v'},{user:{username:'owner'}} as any,{} as any));
 const stored=await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) RETURN v.body AS body");results.push({error,body:stored.records[0].get('body'),events:eventShape()});
 }
 assert.deepEqual(results[1],results[0]);assert.equal((results[1] as any).body,'Original');assert.ok((results[1] as any).error);assert.deepEqual((results[1] as any).events,[]);
});
