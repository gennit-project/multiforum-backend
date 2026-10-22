import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import type {Driver} from 'neo4j-driver';
import type {GraphQLResolveInfo} from 'graphql';
import type {GraphQLContext} from '../../types/context.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import typeDefs from '../../typeDefs.js';
import {initializeOgmFromExistingSchema} from '../../services/initializeOgmFromExistingSchema.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createCommentVoteRepository,COMMENT_VOTE_SELECTION,type CommentVoteRepository} from '../../services/persistence/commentVoteRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import upvote from '../../customResolvers/mutations/upvoteComment.js';
import undo from '../../customResolvers/mutations/undoUpvoteComment.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];let repository:CommentVoteRepository;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
before(async()=>{driver=await startNeo4j();const app=getCustomResolvers(driver);ogm=app.ogm;const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const schema=await neo.getSchema();initializeOgmFromExistingSchema(ogm,neo,schema);registerGeneratedSchema(driver,schema);repository=createCommentVoteRepository(driver);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{await engine.close();await stopNeo4j();});
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const normalize=(x:unknown)=>JSON.parse(JSON.stringify(x,function(key,value){return ['timestamp','createdAt','updatedAt'].includes(key)?'<time>':key==='id'&&this.event?'<node-id>':value;}));
const legacy:CommentVoteRepository={findComment:async id=>ogm.model('Comment').find({where:{id},selectionSet:COMMENT_VOTE_SELECTION}),findVoter:async username=>ogm.model('User').find({where:{username},selectionSet:'{username commentKarma}'}),setAuthorKarma:async(username,commentKarma)=>{await ogm.model('User').update({where:{username},update:{commentKarma}});}};
// The nested UpvotedByUsers projection applies a default limit of 25; which 25 (and order) is only
// stable within a run, so reduce it to a count and normalize temporal fields before snapshotting.
const snapComment=(rows:any)=>{const r=plain(rows);if(r[0]&&Array.isArray(r[0].UpvotedByUsers))r[0].UpvotedByUsers=r[0].UpvotedByUsers.length;return JSON.parse(JSON.stringify(r,(k,v)=>['createdAt','updatedAt','timestamp'].includes(k)&&v!==null?'<time>':v));};
const seed=async(valid=true)=>driver.executeQuery(`CREATE (a:User {username:'author',commentKarma:7${valid?',createdAt:datetime()':''}}), (v:User {username:'voter',commentKarma:25,createdAt:datetime()}), (c:Comment {id:'c',weightedVotesCount:3}) CREATE (a)-[:AUTHORED_COMMENT]->(c)`);
const state=async()=>plain((await driver.executeQuery("MATCH (a:User {username:'author'}),(c:Comment {id:'c'}) OPTIONAL MATCH (u:User)-[:UPVOTED_COMMENT]->(c) RETURN a.commentKarma AS karma,c.weightedVotesCount AS weight,collect(u.username) AS voters")).records.map(r=>({karma:Number(r.get('karma')),weight:Number(r.get('weight')),voters:r.get('voters')})));
test('comment/user snapshots preserve missing rows, author unions, nested default limit and invalid scalar errors',async(t)=>{
 assert.deepEqual(await repository.findComment('missing'),[]);assert.deepEqual(await repository.findVoter('missing'),[]);
 await seed();await driver.executeQuery("MATCH (c:Comment {id:'c'}) UNWIND range(1,28) AS i CREATE (:User {username:'u'+toString(i)})-[:UPVOTED_COMMENT]->(c)");
 const c1=plain(await repository.findComment('c'));assert.equal(c1[0].UpvotedByUsers.length,25);assert.equal(c1[0].UpvotedByUsersAggregate.count,28);t.assert.snapshot(snapComment(c1));t.assert.snapshot(await repository.findVoter('voter'));
 await driver.executeQuery("MATCH (:User)-[r:AUTHORED_COMMENT]->(c:Comment) DELETE r CREATE (:ModerationProfile {displayName:'mod',createdAt:datetime()})-[:AUTHORED_COMMENT]->(c)");t.assert.snapshot(snapComment(await repository.findComment('c')));
 await resetDatabase(driver);await seed(false);await assert.rejects(repository.findComment('c'),/Cannot return null for non-nullable field User\.createdAt/);
});
test('karma generated write preserves native events and default projection failure after committed write',async(t)=>{
 for(const valid of [true,false]){
  await resetDatabase(driver);await seed(valid);events=[];
  if(valid)await repository.setAuthorKarma('author',8);else await assert.rejects(repository.setAuthorKarma('author',8),/Cannot return null for non-nullable field User\.createdAt/);
  const actual={state:await state(),events:normalize(events)};assert.equal(actual.state[0].karma,8);assert.ok(actual.events.length>0);t.assert.snapshot(actual);
 }
});
test('full upvote then undo keeps raw transaction and separate generated karma write behavior',async()=>{
 for(const repo of [repository]){
  await resetDatabase(driver);await seed();events=[];
  const args={commentId:'c',username:'voter'};const context={user:{username:'not-voter'}} as GraphQLContext;
  const added=await upvote({driver,repository:repo})(null,args,context,{} as GraphQLResolveInfo);const addedState=await state();
  assert.ok(added);assert.equal(added.UpvotedByUsersAggregate.count,1);assert.deepEqual(addedState[0].voters,['voter']);assert.equal(addedState[0].karma,8);
  const removed=await undo({driver,repository:repo})(null,args,context,{} as GraphQLResolveInfo);
  assert.equal(removed.UpvotedByUsersAggregate.count,0);assert.deepEqual(await state(),[{karma:7,weight:3,voters:[]}]);assert.equal(events.length,2);
   }
});
