import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {protectIssueModelIdentity} from '../../services/issueTargetIdentity.js';
import lockIssue from '../../customResolvers/mutations/lockIssue.js';
import unlockIssue from '../../customResolvers/mutations/unlockIssue.js';
import {createIssueLockRepository} from '../../services/persistence/issueLockRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import {installAgeGateReconcile} from '../../services/ageGate/reconcile.js';
import {getAgeGateStatements} from '../../services/ageGate/definitions.js';
import {resetDatabase,startNeo4j,stopNeo4j} from './neo4jHarness.js';
let driver:Driver; let ogm:ReturnType<typeof getCustomResolvers>['ogm'];
const engine=createSubscriptionEngine();let events:any[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
before(async()=>{driver=installAgeGateReconcile(await startNeo4j(),getAgeGateStatements(typeDefs));const app=getCustomResolvers(driver);ogm=app.ogm;const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const schema=await neo.getSchema();initializeOgmFromExistingSchema(ogm,neo,schema);registerGeneratedSchema(driver,schema);},{timeout:240_000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});after(async()=>{await engine.close();await stopNeo4j();});
const selection = `{
          issues {
            id
            issueNumber
            title
            body
            channelUniqueName
            isOpen
            createdAt
            updatedAt
            relatedCommentId
            relatedDiscussionId
            relatedEventId
            flaggedServerRuleViolation
            locked
            lockedAt
            lockReason
            LockedBy {
              displayName
            }
            SubscribedToNotifications {
              username
            }
            ActivityFeed {
              id
              actionType
              actionDescription
              createdAt
              ModerationProfile {
                displayName
              }
            }
          }
        }`;
const seed=async()=>{await driver.executeQuery(`CREATE (:ModerationProfile {displayName:'mod'}),(:Issue {id:'i',issueNumber:1,channelUniqueName:'forum',authorName:'mod',isOpen:true,locked:false,createdAt:datetime(),title:'Issue'})`);};
const normalize=(value:unknown)=>{const ids=new Map<string,string>();return JSON.parse(JSON.stringify(value,function(key,value){if(['id','id_from','id_to'].includes(key)){const namespace=key==='id' && this.event?.includes('relationship')?'relationship':'node';const identity=namespace+':'+value;if(!ids.has(identity))ids.set(identity,`id${ids.size}`);return ids.get(identity);}return ['timestamp','createdAt','updatedAt','lockedAt','ageGateTouchedAt'].includes(key)&&value!==null?'<time>':value;}));};
const snapshot=async()=>({graph:(await driver.executeQuery(`MATCH(i:Issue) RETURN i.locked AS locked,i.lockReason AS reason`)).records.map(r=>r.toObject()),comments:(await driver.executeQuery(`MATCH(c:Comment) RETURN c.text AS text,c.isRootComment AS root ORDER BY text`)).records.map(r=>r.toObject()),events:normalize(events)});
const oldRepository=()=>{const model=protectIssueModelIdentity(ogm.model('Issue'));return {findLockState:(id:string)=>model.find({where:{id},selectionSet:'{id issueNumber channelUniqueName locked}'}),updateLock:(id:string,update:any)=>model.update({where:{id},update,selectionSet:selection})};};
const context=()=>({driver,user:{username:'alice',data:{ModerationProfile:{displayName:'mod'}}}} as any);
const run=async(repository:any,failNotify=false)=>{const notifications:any[]=[];const notifySubscribers:any=async(input:any)=>{notifications.push(input.actionType);if(failNotify)throw Error('fake notification failure');return true;};const results=[];for(const factory of [lockIssue,unlockIssue])results.push(await factory({issueLockRepository:repository,notifySubscribers})(null,{issueId:'i',reason:'  raw reason  '},context(),{} as any));return {results:normalize(results),notifications,snapshot:await snapshot()};};
test('actual lock/unlock resolvers preserve explicit response, nested comment/mod links and native event parity',async()=>{
 await seed();const expected=await run(oldRepository());assert.deepEqual(expected.notifications,['lock','unlock']);assert.equal(expected.snapshot.comments.length,2);
 await resetDatabase(driver);await seed();events=[];assert.deepEqual(await run(createIssueLockRepository(driver)),expected);
 const links=await driver.executeQuery('MATCH(c:Comment)<-[r:AUTHORED_COMMENT]-(m:ModerationProfile {displayName: \"mod\"}) RETURN count(r) AS count');assert.equal(links.records[0].get('count').toNumber(),2);
 const nesting=await driver.executeQuery("MATCH(i:Issue {id:'i'})-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)-[:MODERATED_COMMENT]->(c:Comment)<-[:AUTHORED_COMMENT]-(m:ModerationProfile {displayName:'mod'}) WHERE (m)-[:PERFORMED_MODERATION_ACTION]->(a) RETURN count(a) AS count");assert.equal(nesting.records[0].get('count').toNumber(),2);
 const lockedBy=await driver.executeQuery('MATCH(i:Issue)-[r:LOCKED_ISSUE]-() RETURN count(r) AS count');assert.equal(lockedBy.records[0].get('count').toNumber(),0);
});
test('notification failure follows durable lock, nested comment and native events',async()=>{
 await seed();await assert.rejects(run(oldRepository(),true),/Error locking issue/);const expected=await snapshot();assert.equal(expected.graph[0].locked,true);assert.equal(expected.comments.length,1);
 await resetDatabase(driver);await seed();events=[];await assert.rejects(run(createIssueLockRepository(driver),true),/Error locking issue/);assert.deepEqual(await snapshot(),expected);
});
test('identity guard rejects immutable fields before generated mutation',async()=>{await seed();await assert.rejects(createIssueLockRepository(driver).updateLock('i',{issueNumber:9} as any),/identity|immutable/i);assert.equal((await snapshot()).graph[0].locked,false);assert.deepEqual(events,[]);});
test('selected response failure preserves committed lock and generic resolver error',async()=>{
 const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,Issue:{title:()=>{throw Error('projection failure');}}},features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const schema=await neo.getSchema();initializeOgmFromExistingSchema(app.ogm,neo,schema);registerGeneratedSchema(driver,schema);
 const originalOgm=ogm;ogm=app.ogm;
 try{await seed();await assert.rejects(run(oldRepository()),/Error locking issue/);const expected=await snapshot();assert.equal(expected.graph[0].locked,true);assert.equal(expected.comments.length,1);await resetDatabase(driver);await seed();events=[];await assert.rejects(run(createIssueLockRepository(driver)),/Error locking issue/);assert.deepEqual(await snapshot(),expected);}finally{ogm=originalOgm;registerGeneratedSchema(driver,originalOgm.schema);}
});
