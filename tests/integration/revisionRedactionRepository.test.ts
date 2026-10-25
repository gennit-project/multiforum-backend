import redactTextVersionRevision from "../../customResolvers/mutations/redactTextVersionRevision.js";
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createRevisionRedactionRepository} from '../../services/persistence/revisionRedactionRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let repository: ReturnType<typeof createRevisionRedactionRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});
 const schema=await neoSchema.getSchema();registerGeneratedSchema(driver,schema);
 repository=createRevisionRedactionRepository(driver);
 for(const kind of ['create','update','create_relationship']) engine.events.on(kind,(event:Record<string,unknown>)=>events.push({kind,event}));
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);events=[];});
const outcome=async(call:()=>Promise<unknown>)=>call().then(()=>null,(e:Error)=>e.message);

const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
// The seed stamps createdAt/updatedAt via datetime() (wall clock), so normalize temporal fields before snapshotting.
const norm=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,v)=>(['createdAt','updatedAt','timestamp','ageGateTouchedAt'].includes(key)&&v!==null)?'<time>':v));
const targets=[['comment','Comment','HAS_VERSION','AUTHORED_COMMENT'],['discussion body','Discussion','HAS_BODY_VERSION','POSTED_DISCUSSION'],['wiki','WikiPage','HAS_VERSION','AUTHORED_WIKI_PAGE'],['event description','Event','HAS_DESCRIPTION_VERSION','POSTED_BY']] as const;
async function seed(kind:typeof targets[number]=targets[0]){await driver.executeQuery(`CREATE (u:User {username:'owner',createdAt:datetime()}) CREATE (p:${kind[1]} {id:'parent',title:'Title',text:'Text',isRootComment:true,createdAt:datetime()}) CREATE (u)-[:${kind[3]}]->(p) CREATE (v:TextVersion {id:'v',body:'Original',editReason:'Reason',createdAt:datetime()}) CREATE (p)-[:${kind[2]}]->(v) CREATE (u)-[:AUTHORED_VERSION]->(v)`);}
function eventShape(){return events.map(({kind,event})=>({kind,typename:event.typename,relationship:event.relationshipName}));}
test('revision snapshot matches exact selected fields, hidden/missing rows and ID coercion',async(t)=>{
 await seed();for(const id of ['v','absent'])t.assert.snapshot(norm(plain(await repository.findRevision(id))));
 await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) SET v.ageGateRestricted=true");assert.deepEqual(await repository.findRevision('v'),[]);
 t.assert.snapshot(await outcome(()=>repository.findRevision({} as any)));
});
for(const kind of targets)test(`actual redaction resolver parity: ${kind[0]}, authorized no-op still checks permissions`,async(t)=>{
 {await resetDatabase(driver);await seed(kind);events=[];
 const resolver=redactTextVersionRevision({driver,revisionType:kind[0],revisionRedactionRepository:repository,checkModPermissions:(async()=>false) as any,getServerMembership:async()=>({isServerAdmin:false,isServerModerator:false}) as any});
 const result=await resolver(null,{textVersionId:'v'},{user:{username:'owner'}} as any,{} as any);assert.equal(result.body,'[deleted]');
 const again=await resolver(null,{textVersionId:'v'},{user:{username:'owner'}} as any,{} as any);assert.equal(again.body,'[deleted]');
 await assert.rejects(()=>resolver(null,{textVersionId:'v'},{user:{username:'outsider'}} as any,{} as any),/No channel specified|permission/);
 const stored=await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) RETURN v.body AS body, v.ageGateTouchedAt IS NOT NULL AS touched");const output={body:stored.records[0].get('body'),touched:stored.records[0].get('touched')};
 t.assert.snapshot(output);
 }
});
test('hidden revision fails before target authentication',async()=>{
 await seed();await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) SET v.ageGateRestricted=true");let auth=0;
 const resolver=redactTextVersionRevision({driver,revisionType:'comment',getUserData:async()=>{auth++;throw Error('unexpected auth');}});
 await assert.rejects(()=>resolver(null,{textVersionId:'v'},{} as any,{} as any),/comment revision not found/);assert.equal(auth,0);
});
test('post-read invalid temporal value preserves baseline transaction failure boundary',async(t)=>{
 {await resetDatabase(driver);await seed();events=[];
 const repo={...repository,findRevision:async(id:string)=>{const rows=await repository.findRevision(id);await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) SET v.createdAt='invalid' ");return rows;}};
 const resolver=redactTextVersionRevision({driver,revisionType:'comment',revisionRedactionRepository:repo});
 const error=await outcome(()=>resolver(null,{textVersionId:'v'},{user:{username:'owner'}} as any,{} as any));
 const stored=await driver.executeQuery("MATCH (v:TextVersion {id:'v'}) RETURN v.body AS body");const result={error,body:stored.records[0].get('body')};
 assert.equal(result.body,'Original');assert.ok(result.error);t.assert.snapshot(result);
 }
});
