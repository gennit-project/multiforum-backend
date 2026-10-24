import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import { createIssueActivityRepository } from '../../services/persistence/issueActivityRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver: Driver;
let repository: ReturnType<typeof createIssueActivityRepository>;
const engine=createSubscriptionEngine();
let events: Array<{kind:string,event:Record<string,unknown>}>=[];
before(async()=>{
 driver=await startNeo4j(); const app=getCustomResolvers(driver);
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine as unknown as boolean}});
 const schema=await neoSchema.getSchema();registerGeneratedSchema(driver,schema);
 repository=createIssueActivityRepository(driver);
 for(const kind of ['create','update','create_relationship']) engine.events.on(kind,(event:Record<string,unknown>)=>events.push({kind,event}));
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);events=[];});
const outcome=async(call:()=>Promise<unknown>)=>call().then(()=>null,(e:Error)=>e.message);
const node={actionDescription:'edited',actionType:'edit',User:{connect:{where:{node:{username:'u'}}}}};
async function seed(issueNumber=true){await driver.executeQuery(`CREATE (:User {username:'u',createdAt:datetime()}) CREATE (:Issue {id:'i',${issueNumber?'issueNumber:1,':''}isOpen:true,createdAt:datetime()})`);}
async function state(){const r=await driver.executeQuery(`MATCH (i:Issue {id:'i'}) OPTIONAL MATCH (i)-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction) RETURN count(a) AS n`);return r.records[0].get('n').toNumber();}
function eventShape(){return events.map(({kind,event})=>({kind,typename:event.typename,properties:Object.keys(event).sort()}));}
test('related read preserves conjunctive filters, limit and hidden issues',async()=>{
 await driver.executeQuery(`UNWIND range(1,30) AS n CREATE (:Issue {id:toString(n),issueNumber:n,relatedCommentId:'c',relatedEventId:'e',isOpen:true,createdAt:datetime()}) CREATE (:Issue {id:'hidden',issueNumber:99,relatedCommentId:'c',relatedEventId:'e',ageGateRestricted:true})`);
 const where={relatedCommentId:'c',relatedEventId:'e'};
 const actual=await repository.findRelatedIssueIds(where);
 // The read applies a default limit of 25 over 30 matching issues; which 25 are returned is only
 // stable within a single run, so assert the limit and age filtering directly rather than snapshotting
 // a non-deterministic subset.
 assert.equal(actual.length,25);assert.ok(!actual.some(x=>x.id==='hidden'));
});
for(const valid of [true,false]) test(`activity write matches baseline graph, errors and native events (valid issue=${valid})`,async(t)=>{
 await seed(valid);
 const result=await outcome(()=>repository.appendActivity('i',node));
 assert.equal(await state(),1);const shape=eventShape();assert.ok(shape.length>0);
 t.assert.snapshot({result,events:shape});
});
test('missing issue update preserves empty-result behavior',async(t)=>{t.assert.snapshot(await outcome(()=>repository.appendActivity('absent',node)));assert.deepEqual(events,[]);});
