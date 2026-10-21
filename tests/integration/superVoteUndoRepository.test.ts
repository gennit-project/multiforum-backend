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
import {createSuperVoteUndoRepository,SUPER_VOTE_COMMENT_SELECTION,SUPER_VOTE_DISCUSSION_SELECTION,type SuperVoteUndoRepository} from '../../services/persistence/superVoteUndoRepository.js';
import {createSubscriptionEngine} from '../../services/subscriptionEngine.js';
import undo from '../../customResolvers/mutations/undoSuperUpvote.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;let ogm:ReturnType<typeof getCustomResolvers>['ogm'];let repository:SuperVoteUndoRepository;
const engine=createSubscriptionEngine();let events:unknown[]=[];
for(const kind of ['create','update','create_relationship','delete_relationship','delete'])engine.events.on(kind,event=>events.push(event));
before(async()=>{driver=await startNeo4j();const app=getCustomResolvers(driver);ogm=app.ogm;const neo=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:engine}});const schema=await neo.getSchema();initializeOgmFromExistingSchema(ogm,neo,schema);registerGeneratedSchema(driver,schema);repository=createSuperVoteUndoRepository(driver);},{timeout:240000});
beforeEach(async()=>{await resetDatabase(driver);events=[];});
after(async()=>{await engine.close();await stopNeo4j();});
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const normalize=(x:unknown)=>JSON.parse(JSON.stringify(x,function(key,value){return ['timestamp','createdAt','updatedAt'].includes(key)?'<time>':key==='id'&&this.event?'<node-id>':value;}));
const legacy:SuperVoteUndoRepository={findComment:async id=>ogm.model('Comment').find({where:{id},selectionSet:SUPER_VOTE_COMMENT_SELECTION}),findDiscussion:async id=>ogm.model('DiscussionChannel').find({where:{id},selectionSet:SUPER_VOTE_DISCUSSION_SELECTION})};
const seed=async()=>driver.executeQuery("CREATE (a:User {username:'author',commentKarma:7,discussionKarma:7}), (v:User {username:'voter'}),(c:Comment {id:'c',weightedVotesCount:2}),(d:Discussion {id:'d'}),(dc:DiscussionChannel {id:'dc',weightedVotesCount:2}) CREATE (a)-[:AUTHORED_COMMENT]->(c), (a)-[:POSTED_DISCUSSION]->(d)<-[:POSTED_IN_CHANNEL]-(dc),(v)-[:SUPER_UPVOTED_COMMENT]->(c),(v)-[:SUPER_UPVOTED_DISCUSSION]->(dc)");
test('both snapshots retain missing rows, author branches and nested default25 limit',async()=>{
 await seed();assert.deepEqual(await repository.findComment('missing'),[]);assert.deepEqual(await repository.findDiscussion('missing'),[]);
 await driver.executeQuery("MATCH (c:Comment),(dc:DiscussionChannel) UNWIND range(1,28) AS i CREATE (u:User {username:'u'+toString(i)}) CREATE (u)-[:SUPER_UPVOTED_COMMENT]->(c),(u)-[:SUPER_UPVOTED_DISCUSSION]->(dc)");
 for(const [fn,id] of [['findComment','c'],['findDiscussion','dc']] as const){const expected=plain(await legacy[fn](id));assert.equal(expected[0].SuperUpvotedByUsers.length,25);assert.deepEqual(plain(await repository[fn](id)),expected);}
 await driver.executeQuery("MATCH (:User)-[r:AUTHORED_COMMENT]->(c:Comment) DELETE r CREATE (:ModerationProfile {displayName:'mod'})-[:AUTHORED_COMMENT]->(c)");let message='';await assert.rejects(legacy.findComment('c'),e=>{message=(e as Error).message;return true;});assert.match(message,/User.username/);await assert.rejects(repository.findComment('c'),{message});
});
for(const sourceType of ['comment','discussion'] as const)test(`${sourceType} full undo preserves transaction state, scratchpad deletion and no generated write events`,async()=>{
 let expected:unknown;const sourceId=sourceType==='comment'?'c':'dc';
 for(const repo of [legacy,repository]){
 await resetDatabase(driver);await seed();await driver.executeQuery("MATCH (v:User {username:'voter'}) CREATE (v)-[:WROTE_SCRATCHPAD_ENTRY]->(:ScratchpadEntry {id:'entry',sourceId:$sourceId,sourceType:$sourceType})",{sourceId,sourceType});events=[];
 const result=await undo({driver,repository:repo})(null,{sourceType,sourceId},{user:{username:'voter'}} as GraphQLContext,{} as GraphQLResolveInfo);assert.equal(result.success,true);assert.deepEqual(result.superUpvotedByUsers,[]);
 const state=(await driver.executeQuery("MATCH (a:User {username:'author'}),(c:Comment),(dc:DiscussionChannel) RETURN a.commentKarma AS ck,a.discussionKarma AS dk,c.weightedVotesCount AS cw,dc.weightedVotesCount AS dw,COUNT {(:ScratchpadEntry)} AS entries")).records[0];
 const values=['ck','dk','cw','dw','entries'].map(k=>Number(state.get(k)));assert.deepEqual(values,sourceType==='comment'?[6,7,1,2,0]:[7,6,2,1,0]);assert.deepEqual(events,[]);
 const actual={result,values};if(repo===legacy)expected=actual;else assert.deepEqual(actual,expected);
 }
});
