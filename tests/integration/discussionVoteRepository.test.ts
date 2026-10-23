import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLResolveInfo} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createDiscussionChannelVoteRepository,type DiscussionChannelVoteRepository} from '../../services/persistence/discussionChannelVoteRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import upvote from '../../customResolvers/mutations/upvoteDiscussionChannel.js';
import undo from '../../customResolvers/mutations/undoUpvoteDiscussionChannel.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let repository:DiscussionChannelVoteRepository;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,(event: unknown)=>events.push(event));
before(async()=>{driver=await startNeo4j();const app=getCustomResolvers(driver);const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const schema=await neo.getSchema();registerGeneratedSchema(driver,schema);repository=createDiscussionChannelVoteRepository(driver);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{await engine.close();await stopNeo4j();});
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const normalize=(x:unknown)=>JSON.parse(JSON.stringify(x,function(key,value){return ['timestamp','createdAt','updatedAt'].includes(key)?'<time>':key==='id'&&this.event?'<node-id>':value;}));
// The nested UpvotedByUsers projection applies a default limit of 25; which 25 (and order) is only
// stable within a run, so reduce it to a count and normalize temporal fields before snapshotting.
const snapChannel=(rows:any)=>{const r=plain(rows);if(r[0]&&Array.isArray(r[0].UpvotedByUsers))r[0].UpvotedByUsers=r[0].UpvotedByUsers.length;return JSON.parse(JSON.stringify(r,(k,v)=>['createdAt','updatedAt','timestamp'].includes(k)&&v!==null?'<time>':v));};
const seed=async(valid=true)=>driver.executeQuery(`CREATE (a:User {username:'author',discussionKarma:7${valid?',createdAt:datetime()':''}}), (v:User {username:'voter',discussionKarma:25,createdAt:datetime()}), (c:DiscussionChannel {id:'c',weightedVotesCount:3}) CREATE (a)-[:POSTED_DISCUSSION]->(d:Discussion {id:'d'})<-[:POSTED_IN_CHANNEL]-(c)`);
const state=async()=>plain((await driver.executeQuery("MATCH (a:User {username:'author'}),(c:DiscussionChannel {id:'c'}) OPTIONAL MATCH (u:User)-[:UPVOTED_DISCUSSION]->(c) RETURN a.discussionKarma AS karma,c.weightedVotesCount AS weight,collect(u.username) AS voters")).records.map(r=>({karma:Number(r.get('karma')),weight:Number(r.get('weight')),voters:r.get('voters')})));
test('discussionChannel/user snapshots preserve missing rows, missing authors, nested default limit and invalid scalar errors',async(t)=>{
 assert.deepEqual(await repository.findDiscussionChannel('missing'),[]);assert.deepEqual(await repository.findVoter('missing'),[]);
 await seed();await driver.executeQuery("MATCH (c:DiscussionChannel {id:'c'}) UNWIND range(1,28) AS i CREATE (:User {username:'u'+toString(i)})-[:UPVOTED_DISCUSSION]->(c)");
 const c1=plain(await repository.findDiscussionChannel('c'));assert.equal(c1[0].UpvotedByUsers.length,25);assert.equal(c1[0].UpvotedByUsersAggregate.count,28);t.assert.snapshot(snapChannel(c1));t.assert.snapshot(await repository.findVoter('voter'));
 await driver.executeQuery("MATCH (:User)-[r:POSTED_DISCUSSION]->(:Discussion) DELETE r");t.assert.snapshot(snapChannel(await repository.findDiscussionChannel('c')));
 await resetDatabase(driver);await seed(false);await assert.rejects(repository.findDiscussionChannel('c'),/Cannot return null for non-nullable field User\.createdAt/);
});
test('karma generated write preserves native events and default projection failure after committed write',async(t)=>{
 for(const valid of [true,false]){
  await resetDatabase(driver);await seed(valid);events=[];
  if(valid)await repository.setAuthorKarma('author',8);else await assert.rejects(repository.setAuthorKarma('author',8),/Cannot return null for non-nullable field User\.createdAt/);
  const actual={state:await state(),events:normalize(events)};assert.equal(actual.state[0].karma,8);assert.ok(actual.events.length>0);t.assert.snapshot(actual);
 }
});
test('full upvote then undo keeps raw transaction and separate generated karma write behavior',async(t)=>{
 {
  await resetDatabase(driver);await seed();events=[];
  const args={discussionChannelId:'c',username:'voter'};const context={user:{username:'not-voter'}} as GraphQLContext;
  const added=await upvote({driver,repository})(null,args,context,{} as GraphQLResolveInfo);const addedState=await state();
  assert.ok(added);assert.equal(added.UpvotedByUsersAggregate.count,1);assert.deepEqual(addedState[0].voters,['voter']);assert.equal(addedState[0].karma,8);
  const removed=await undo({driver,repository})(null,args,context,{} as GraphQLResolveInfo);
  assert.ok(removed);assert.equal(removed.UpvotedByUsersAggregate.count,0);assert.deepEqual(await state(),[{karma:7,weight:3,voters:[]}]);assert.equal(events.length,2);
  t.assert.snapshot(normalize({added,addedState,removed,state:await state(),events}));
 }
});
