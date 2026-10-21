import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLResolveInfo} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import getCustomResolvers from '../../customResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createDiscussionChannelVoteRepository,DISCUSSION_CHANNEL_VOTE_SELECTION,type DiscussionChannelVoteRepository} from '../../services/persistence/discussionChannelVoteRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import upvote from '../../customResolvers/mutations/upvoteDiscussionChannel.js';
import undo from '../../customResolvers/mutations/undoUpvoteDiscussionChannel.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];let repository:DiscussionChannelVoteRepository;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
before(async()=>{driver=await startNeo4j();const app=getCustomResolvers(driver);ogm=app.ogm;const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const schema=await neo.getSchema();initializeOgmFromExistingSchema(ogm,neo,schema);registerGeneratedSchema(driver,schema);repository=createDiscussionChannelVoteRepository(driver);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{await engine.close();await stopNeo4j();});
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const normalize=(x:unknown)=>JSON.parse(JSON.stringify(x,function(key,value){return ['timestamp','createdAt','updatedAt'].includes(key)?'<time>':key==='id'&&this.event?'<node-id>':value;}));
const legacy:DiscussionChannelVoteRepository={findDiscussionChannel:async id=>ogm.model('DiscussionChannel').find({where:{id},selectionSet:DISCUSSION_CHANNEL_VOTE_SELECTION}),findVoter:async username=>ogm.model('User').find({where:{username},selectionSet:'{username discussionKarma}'}),setAuthorKarma:async(username,discussionKarma)=>{await ogm.model('User').update({where:{username},update:{discussionKarma}});}};
const seed=async(valid=true)=>driver.executeQuery(`CREATE (a:User {username:'author',discussionKarma:7${valid?',createdAt:datetime()':''}}), (v:User {username:'voter',discussionKarma:25,createdAt:datetime()}), (c:DiscussionChannel {id:'c',weightedVotesCount:3}) CREATE (a)-[:POSTED_DISCUSSION]->(d:Discussion {id:'d'})<-[:POSTED_IN_CHANNEL]-(c)`);
const state=async()=>plain((await driver.executeQuery("MATCH (a:User {username:'author'}),(c:DiscussionChannel {id:'c'}) OPTIONAL MATCH (u:User)-[:UPVOTED_DISCUSSION]->(c) RETURN a.discussionKarma AS karma,c.weightedVotesCount AS weight,collect(u.username) AS voters")).records.map(r=>({karma:Number(r.get('karma')),weight:Number(r.get('weight')),voters:r.get('voters')})));
test('discussionChannel/user snapshots preserve missing rows, missing authors, nested default limit and invalid scalar errors',async()=>{
 assert.deepEqual(await repository.findDiscussionChannel('missing'),[]);assert.deepEqual(await repository.findVoter('missing'),[]);
 await seed();await driver.executeQuery("MATCH (c:DiscussionChannel {id:'c'}) UNWIND range(1,28) AS i CREATE (:User {username:'u'+toString(i)})-[:UPVOTED_DISCUSSION]->(c)");
 const expected=plain(await legacy.findDiscussionChannel('c'));assert.equal(expected[0].UpvotedByUsers.length,25);assert.equal(expected[0].UpvotedByUsersAggregate.count,28);assert.deepEqual(plain(await repository.findDiscussionChannel('c')),expected);assert.deepEqual(await repository.findVoter('voter'),await legacy.findVoter('voter'));
 await driver.executeQuery("MATCH (:User)-[r:POSTED_DISCUSSION]->(:Discussion) DELETE r");assert.deepEqual(plain(await repository.findDiscussionChannel('c')),plain(await legacy.findDiscussionChannel('c')));
 await resetDatabase(driver);await seed(false);let message='';await assert.rejects(legacy.findDiscussionChannel('c'),e=>{message=(e as Error).message;return true;});await assert.rejects(repository.findDiscussionChannel('c'),{message});
});
test('karma generated write preserves native events and default projection failure after committed write',async()=>{
 for(const valid of [true,false]){
  let expected:unknown;let message='';
  for(const repo of [legacy,repository]){
   await resetDatabase(driver);await seed(valid);events=[];
   if(valid)await repo.setAuthorKarma('author',8);else await assert.rejects(repo.setAuthorKarma('author',8),e=>{if(!message)message=(e as Error).message;assert.equal((e as Error).message,message);return true;});
   const actual={state:await state(),events:normalize(events)};if(repo===legacy){expected=actual;assert.equal(actual.state[0].karma,8);assert.ok(actual.events.length>0);}else assert.deepEqual(actual,expected);
  }
 }
});
test('full upvote then undo keeps raw transaction and separate generated karma write behavior',async()=>{
 let expected:unknown;
 for(const repo of [legacy,repository]){
  await resetDatabase(driver);await seed();events=[];
  const args={discussionChannelId:'c',username:'voter'};const context={user:{username:'not-voter'}} as GraphQLContext;
  const added=await upvote({driver,repository:repo})(null,args,context,{} as GraphQLResolveInfo);const addedState=await state();
  assert.ok(added);assert.equal(added.UpvotedByUsersAggregate.count,1);assert.deepEqual(addedState[0].voters,['voter']);assert.equal(addedState[0].karma,8);
  const removed=await undo({driver,repository:repo})(null,args,context,{} as GraphQLResolveInfo);
  assert.ok(removed);assert.equal(removed.UpvotedByUsersAggregate.count,0);assert.deepEqual(await state(),[{karma:7,weight:3,voters:[]}]);assert.equal(events.length,2);
  const actual=plain({added,addedState,removed,state:await state(),events:normalize(events)});if(repo===legacy)expected=actual;else assert.deepEqual(actual,expected);
 }
});
