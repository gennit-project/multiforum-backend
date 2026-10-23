import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema,executeGeneratedOperation} from '../../services/persistence/generatedSchemaOperations.js';
import { createEventRevisionRepository } from '../../services/persistence/eventRevisionRepository.js';
import middleware from '../../middleware/eventVersionHistoryMiddleware.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {installAgeGateReconcile} from '../../services/ageGate/reconcile.js';
import {getAgeGateStatements} from '../../services/ageGate/definitions.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver;let baseSchema:Awaited<ReturnType<Neo4jGraphQL['getSchema']>>;
const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=installAgeGateReconcile(await startNeo4j(),getAgeGateStatements(typeDefs));const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});baseSchema=await neo.getSchema();registerGeneratedSchema(driver,baseSchema);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const seed=async(valid=true)=>{await driver.executeQuery(`CREATE (p:User {username:'poster',createdAt:datetime()}),(u:User {username:'editor',createdAt:datetime()}),(a:User {username:'prior',createdAt:datetime()}),(e:Event {id:'e',title:'old title',description:'old description',createdAt:datetime(),startTime:datetime('2026-01-01T00:00:00Z'),endTime:datetime('2026-01-02T00:00:00Z')}),(c:EventChannel {channelUniqueName:'forum'}) CREATE (p)-[:POSTED_BY]->(e),(c)-[:POSTED_IN_CHANNEL]->(e),(e)-[:DESCRIPTION_LAST_EDITED_BY]->(a) SET e.canceled=$canceled`,{canceled:valid?false:null});};
const normalize=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const namespace=key==='id'&&this.event?.includes('relationship')?'relationship':'node';const identity=namespace+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','ageGateTouchedAt'].includes(key)&&value!==null?'<time>':value;}));};
const state=async()=>({revisions:(await driver.executeQuery(`MATCH(e:Event {id:'e'})-[r:HAS_TITLE_VERSION|HAS_DESCRIPTION_VERSION]->(v:TextVersion)<-[:AUTHORED_VERSION]-(u:User) RETURN type(r) AS kind,v.body AS body,u.username AS author,v.ageGateTouchedAt IS NOT NULL AS touched ORDER BY kind`)).records.map(r=>r.toObject()),event:(await driver.executeQuery(`MATCH(e:Event {id:'e'}) OPTIONAL MATCH(e)-[:DESCRIPTION_LAST_EDITED_BY]->(u:User) RETURN e.title AS title,e.description AS description,u.username AS editor`)).records.map(r=>r.toObject()),events:normalize(events)});
const run=async(repository:any,failResolver=false)=>{const calls:any[]=[];const ctx:any={driver,eventRevisionRepository:repository,user:{username:'editor'},notificationWriter:{createForUser:async(value:any)=>{calls.push(['notify',value]);return true;}},issueActivityRepository:{findRelatedIssueIds:async()=>[{id:'issue'}],appendActivity:async(_id:string,node:any)=>{const linked=(await driver.executeQuery('MATCH(:Event {id:"e"})-[:HAS_TITLE_VERSION|HAS_DESCRIPTION_VERSION]->(v:TextVersion {id:$id}) RETURN count(v) AS n',{id:node.Revision.connect.where.node.id})).records[0].get('n').toNumber();calls.push(['activity',node.actionDescription,linked]);}}};
 // Activity notifications are out of scope and deliberately disabled by omitting the optional driver capability.
 const realDriver=ctx.driver;delete ctx.driver;
 const resolve=async()=>{calls.push(['resolve']);if(failResolver)throw Error('resolver rejected');return executeGeneratedOperation(driver,'mutation($where:EventWhere!,$update:EventUpdateInput!){updateEvents(where:$where,update:$update){events{id}}}',{where:{id:'e'},update:{title:'new title',description:'new description'}});};
 try{await middleware.Mutation.updateEvents(resolve,null,{where:{id:'e'},update:{title:'new title',description:'new description'}},ctx,{} as any);}catch(error){if(!failResolver)throw error;assert.match((error as Error).message,/resolver rejected/);}finally{ctx.driver=realDriver;}
 return {state:await state(),calls};};
for(const failResolver of [false,true])test(`actual middleware preserves pre-resolver revision commits, attribution and native events (resolver rejects=${failResolver})`,async(t)=>{
 await seed();const result=await run(createEventRevisionRepository(driver),failResolver);assert.deepEqual(result.state.revisions,[{kind:'HAS_DESCRIPTION_VERSION',body:'old description',author:'prior',touched:true},{kind:'HAS_TITLE_VERSION',body:'old title',author:'editor',touched:true}]);assert.equal(result.state.event[0].editor,'editor');assert.deepEqual(result.calls.slice(0,3),[['activity','edited the event title',1],['activity','edited the event description',1],['resolve']]);assert.equal(result.calls.filter(c=>c[0]==='notify').length,failResolver?0:1);if(!failResolver)assert.match(result.calls[result.calls.length-1][1].text,/\[old title\]/);
 t.assert.snapshot(normalize(result));
});
test('missing canceled causes postcommit default-projection failures, yet later resolver and author notification continue',async(t)=>{await seed(false);const result=await run(createEventRevisionRepository(driver));assert.equal(result.state.revisions.length,2);assert.equal(result.state.event[0].editor,'editor');assert.deepEqual(result.calls.map(c=>c[0]),['resolve','notify']);t.assert.snapshot(normalize(result));});
test('snapshot nested limits and generated coercion remain identical',async(t)=>{await seed();await driver.executeQuery("MATCH(e:Event {id:'e'}) UNWIND range(1,30) AS n CREATE(e)-[:HAS_TITLE_VERSION]->(:TextVersion {id:'t'+toString(n),body:'t',createdAt:datetime()}) CREATE(e)-[:HAS_DESCRIPTION_VERSION]->(:TextVersion {id:'d'+toString(n),body:'d',createdAt:datetime()})");const actual=await createEventRevisionRepository(driver).findSnapshot('e');assert.equal(actual[0].PastTitleVersions?.length,25);assert.equal(actual[0].PastDescriptionVersions?.length,25);
 // The nested PastTitle/DescriptionVersions projections apply a default limit of 25 over 30 versions;
 // which 25 (and their order) is only stable within a run, so snapshot with those arrays reduced to a count.
 const snap=normalize(actual) as any;snap[0].PastTitleVersions=snap[0].PastTitleVersions.length;snap[0].PastDescriptionVersions=snap[0].PastDescriptionVersions.length;t.assert.snapshot(snap);
 await assert.rejects(createEventRevisionRepository(driver).createPreviousText(12 as any,'editor'),/String cannot represent a non string value/);});
test('default create response failure leaves orphan versions while editor replacement and later notification proceed',async(t)=>{
 const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,TextVersion:{editReason:()=>{throw Error('version projection failure');}}},features:{filters:{String:{MATCHES:true}},subscriptions:engine}});registerGeneratedSchema(driver,await neo.getSchema());
 try{await seed();const count=async()=>(await driver.executeQuery('MATCH(v:TextVersion) RETURN count(v) AS n')).records[0].get('n').toNumber();const result=await run(createEventRevisionRepository(driver));assert.equal(await count(),2);assert.deepEqual(result.state.revisions,[]);assert.equal(result.state.event[0].editor,'editor');assert.deepEqual(result.calls.map(c=>c[0]),['resolve','notify']);t.assert.snapshot(normalize(result));}finally{registerGeneratedSchema(driver,baseSchema);}
});
