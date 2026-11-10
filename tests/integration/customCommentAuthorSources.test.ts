import {canonicalRootComment} from "../../services/customCommentSources.js";
import {authorSourceType} from "../../services/authorSourceType.js";
import {getCommentsQuery,getCommentRepliesQuery,getEventCommentsQuery,getCommentSectionChannelQuery} from '../../customResolvers/cypher/cypherQueries.js';
import type {CustomViewerComment,CustomRootComment,CustomReplyComment,CustomEventComment,CustomCommentSectionChannel} from '../../customResolvers/contracts/customCommentSources.js';
import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import resolvers from '../helpers/getTestResolvers.js';
import identityMiddleware from '../../middleware/userChildIdentityMiddleware.js';
import permissions from '../../permissions.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{
 driver=await startNeo4j();
 const generated=await new Neo4jGraphQL({driver,typeDefs,resolvers:resolvers(driver).resolvers}).getSchema();
 schema=applyMiddleware(generated,identityMiddleware,permissions);
},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
 await resetDatabase(driver);
 await driver.executeQuery(`CREATE(ch:Channel{uniqueName:'forum'}),(d:Discussion{id:'discussion'}),
  (dc:DiscussionChannel{id:'post',discussionId:'discussion',channelUniqueName:'forum'}),(e:Event{id:'event'}),
  (c:Comment{id:'root',text:'root',createdAt:datetime(),isRootComment:true}),
  (r:Comment{id:'reply',text:'reply',createdAt:datetime(),isRootComment:false}),
  (a:Comment{id:'answer',text:'answer',createdAt:datetime()}),(m:ModerationProfile),
  (human:User{username:'human-account'})
 CREATE(dc)-[:POSTED_IN_CHANNEL]->(d),(dc)-[:POSTED_IN_CHANNEL]->(ch),
  (dc)-[:CONTAINS_COMMENT]->(c),(e)-[:HAS_COMMENT]->(c),(r)-[:IS_REPLY_TO]->(c),(a)-[:IS_REPLY_TO]->(dc),
  (m)-[:AUTHORED_COMMENT]->(c),(m)-[:AUTHORED_COMMENT]->(r),(m)-[:AUTHORED_COMMENT]->(a),
  (human)-[:MODERATION_PROFILE]->(m)`);
});
const queries={
 section:(fields:string)=>`{result:getCommentSection(discussionId:"discussion",channelUniqueName:"forum",modName:"",sort:"new"){items:Comments{${fields}}}}`,
 replies:(fields:string)=>`{result:getCommentReplies(commentId:"root",modName:"",sort:new){items:ChildComments{${fields}}}}`,
 event:(fields:string)=>`{result:getEventComments(eventId:"event",sort:new){items:Comments{${fields}}}}`,
 answers:(fields:string)=>`{result:getCommentSection(discussionId:"discussion",channelUniqueName:"forum",modName:"",sort:"new"){channel:DiscussionChannel{items:Answers{${fields}}}}}`,
};
const execute=(source:string,variableValues:Record<string,unknown>={},viewer:string|null=null)=>graphql({schema,source,variableValues,contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false,user:viewer?{username:viewer,email:null,email_verified:true,data:null}:null}});
for(const kind of Object.keys(queries) as Array<keyof typeof queries>)test(`${kind}: nullable moderator name does not turn the author into a User`,async()=>{
 const result=await execute(queries[kind]('CommentAuthor{__typename}'));
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const value=JSON.parse(JSON.stringify(result.data)).result;
 assert.deepEqual(kind==='answers'?value.channel.items:value.items,[{CommentAuthor:{__typename:'ModerationProfile'}}]);
});

function items(result:Awaited<ReturnType<typeof execute>>,kind:keyof typeof queries){
 const value=JSON.parse(JSON.stringify(result.data)).result;return kind==='answers'?value.channel.items:value.items;
}
for(const kind of Object.keys(queries) as Array<keyof typeof queries>){
 test(`${kind}: missing author stays null`,async()=>{
  await driver.executeQuery('MATCH()-[r:AUTHORED_COMMENT]->() DELETE r');
  const result=await execute(queries[kind]('CommentAuthor{__typename}'));assert.equal(result.errors,undefined);
  assert.deepEqual(items(result,kind),[{CommentAuthor:null}]);
 });
 test(`${kind}: moderator attribution does not expose its human account`,async()=>{
  const result=await execute(queries[kind]('CommentAuthor{__typename ... on ModerationProfile {hidden:User{username}}}'));
  assert.ok(result.errors?.some(error=>error.path && error.path[error.path.length-1]==='hidden'));
  assert.ok(!JSON.stringify(result.data).includes('human-account'));
  assert.ok(!JSON.stringify(result.data).includes('__sourceAuthorType'));
 });
 test(`${kind}: canonical aliases and user fragments retain their own values`,async()=>{
  await driver.executeQuery(`MATCH(m:ModerationProfile)-[r:AUTHORED_COMMENT]->(c:Comment)
   DELETE r SET c.text=c.id+' text'
   WITH collect(c) AS comments CREATE(u:User{username:'alice',displayName:'Alice display'})
   FOREACH(c IN comments|CREATE(u)-[:AUTHORED_COMMENT]->(c))`);
  const source=queries[kind]('text:id id:text author:CommentAuthor {...Author}');
  const result=await execute(source+' fragment Author on CommentAuthor {__typename ... on User {displayName:username username:displayName}}');
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  const id=kind==='answers'?'answer':kind==='replies'?'reply':'root';
  assert.deepEqual(items(result,kind),[{text:id,id:id+' text',author:{__typename:'User',displayName:'alice',username:'Alice display'}}]);
 });
 test(`${kind}: ambiguous labels fail only when the author is requested`,async()=>{
  await driver.executeQuery('MATCH(m:ModerationProfile) SET m:User');
  const skipped=await execute('query($skip:Boolean!)'+queries[kind]('id CommentAuthor @skip(if:$skip){__typename}'),{skip:true});
  assert.equal(skipped.errors,undefined,JSON.stringify(skipped.errors));
  const selected=await execute(queries[kind]('id CommentAuthor{__typename}'));
  assert.ok(selected.errors?.some(error=>error.path && error.path[error.path.length-1]==='CommentAuthor'));
  assert.equal(items(selected,kind)[0].CommentAuthor,null);
 });
 test(`${kind}: invalid user names do not change type or fail unrequested fields`,async()=>{
  await driver.executeQuery(`MATCH(m:ModerationProfile)-[r:AUTHORED_COMMENT]->(c:Comment) DELETE r
   WITH collect(c) AS comments CREATE(u:User{displayName:'Display only'})
   FOREACH(c IN comments|CREATE(u)-[:AUTHORED_COMMENT]->(c))`);
  const safe=await execute(queries[kind]('CommentAuthor{__typename}'));assert.equal(safe.errors,undefined);
  assert.deepEqual(items(safe,kind),[{CommentAuthor:{__typename:'User'}}]);
  const selected=await execute(queries[kind]('CommentAuthor{... on User {bad:username}}'));
  assert.ok(selected.errors?.some(error=>error.path && error.path[error.path.length-1]==='bad'));
 });
}
test('answer source retains the existing five-item cap',async()=>{
 await driver.executeQuery(`MATCH(dc:DiscussionChannel{id:'post'}),(m:ModerationProfile)
  UNWIND range(1,6) AS n CREATE(a:Comment{id:'answer-'+toString(n),text:'answer',createdAt:datetime()+duration({seconds:n})})
  CREATE(a)-[:IS_REPLY_TO]->(dc),(m)-[:AUTHORED_COMMENT]->(a)`);
 const result=await execute(queries.answers('id CommentAuthor{__typename}'));
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));assert.equal(items(result,'answers').length,5);
 assert.deepEqual(items(result,'answers').map((row:{id:string})=>row.id),['answer-6','answer-5','answer-4','answer-3','answer-2']);
});

function keys<T extends object>(value:T,expected:Record<keyof T,true>){assert.deepEqual(Object.keys(value).sort(),Object.keys(expected).sort());}
const commentKeys={id:true,text:true,emoji:true,weightedVotesCount:true,createdAt:true,updatedAt:true,textLastEdited:true,
 archived:true,isSticky:true,stickyAt:true,stickyByUsername:true,CommentAuthor:true,isFavoritedByUser:true,
 UpvotedByUsers:true,UpvotedByUsersAggregate:true,UpvotedByUsersConnection:true,SuperUpvotedByUsers:true,
 ChildCommentsAggregate:true,ChildCommentsConnection:true,PastVersions:true,SubscribedToNotifications:true} as const satisfies Record<keyof CustomViewerComment,true>;
async function richSources(){
 await driver.executeQuery(`MATCH(m:ModerationProfile),(dc:DiscussionChannel{id:'post'}),(ch:Channel),(d:Discussion)
  SET m.displayName='Moderator'
  CREATE(voter:User{username:'voter',displayName:'Voter display',botProfileId:'bot-id',isDeprecated:false}),
   (g:Comment{id:'grandchild',text:'grandchild',createdAt:datetime()}),
   (feedback:Comment{id:'feedback'})
  CREATE(ch)-[:BOT]->(voter),(m)-[:MODERATOR_OF_CHANNEL]->(ch),(voter)-[:POSTED_DISCUSSION]->(d),
   (m)-[:AUTHORED_COMMENT]->(feedback),(voter)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(dc),(voter)-[:UPVOTED_DISCUSSION]->(dc),(voter)-[:SUPER_UPVOTED_DISCUSSION]->(dc)
  WITH voter,g,feedback MATCH(c:Comment) WHERE c.id IN ['root','reply']
  SET c.text=c.id+' text'
  CREATE(voter)-[:UPVOTED_COMMENT]->(c),(voter)-[:SUPER_UPVOTED_COMMENT]->(c),
   (voter)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(c),(feedback)-[:HAS_FEEDBACK_COMMENT]->(c),
   (c)-[:HAS_VERSION]->(version:TextVersion{id:'version-'+c.id,body:'past '+c.id,createdAt:datetime(),editReason:'reason'}),
   (voter)-[:AUTHORED_VERSION]->(version)
  FOREACH(ignored IN CASE WHEN c.id='reply' THEN [1] ELSE [] END|CREATE(g)-[:IS_REPLY_TO]->(c))`);
 await driver.executeQuery("MATCH(r:Comment{id:'reply'}),(e:Event{id:'event'}),(dc:DiscussionChannel{id:'post'}) CREATE(e)-[:HAS_COMMENT]->(r),(dc)-[:CONTAINS_COMMENT]->(r)");
}
function commonKeys(comment:CustomViewerComment){
 assert.ok(comment.CommentAuthor);
 keys(comment.CommentAuthor,{username:true,displayName:true,profilePicURL:true,discussionKarma:true,commentKarma:true,createdAt:true,isBot:true,__sourceAuthorType:true});
 assert.equal(comment.CommentAuthor.__sourceAuthorType,'ModerationProfile');
 for(const users of [comment.UpvotedByUsers,comment.SuperUpvotedByUsers,comment.SubscribedToNotifications]){
  assert.equal(users.length,1);keys(users[0]!,{username:true});
 }
 keys(comment.UpvotedByUsersAggregate,{count:true});keys(comment.ChildCommentsAggregate,{count:true});
 for(const connection of [comment.UpvotedByUsersConnection,comment.ChildCommentsConnection]){
  keys(connection,{totalCount:true,aggregate:true});keys(connection.aggregate,{count:true});keys(connection.aggregate.count,{nodes:true});
 }
 assert.equal(comment.PastVersions.length,1);const version=comment.PastVersions[0]!;
 keys(version,{id:true,body:true,editReason:true,createdAt:true,Author:true});assert.ok(version.Author);keys(version.Author,{username:true});
}
test('all actual custom comment hydration documents retain their exact source projections',async()=>{
 await richSources();const session=driver.session();
 const parameters={discussionChannelId:'post',commentId:'root',eventId:'event',discussionId:'discussion',channelUniqueName:'forum',
  loggedInUsername:'voter',modName:'Moderator',offset:0,limit:10,sortOption:'new',hotAgeOffsetMonths:1,hotGravity:1,answerLimit:5};
 try{
  const root=(await session.run<{comment:CustomRootComment}>(getCommentsQuery,parameters)).records[0]!.get('comment');
  keys(root,{...commentKeys,ParentComment:true,FeedbackComments:true});commonKeys(root);
  assert.equal(root.FeedbackComments.length,1);keys(root.FeedbackComments[0]!,{id:true});
  const reply=(await session.run<{ChildComments:CustomReplyComment[]}>(getCommentRepliesQuery,parameters)).records[0]!.get('ChildComments')[0]!;
  keys(reply,{...commentKeys,ParentComment:true,FeedbackComments:true,Event:true,DiscussionChannel:true});commonKeys(reply);
  assert.ok(reply.Event);keys(reply.Event,{id:true});assert.ok(reply.DiscussionChannel);keys(reply.DiscussionChannel,{id:true,discussionId:true,channelUniqueName:true});
  keys(reply.ParentComment,{id:true});assert.equal(reply.FeedbackComments.length,1);keys(reply.FeedbackComments[0]!,{id:true});
  const event=(await session.run<{comment:CustomEventComment}>(getEventCommentsQuery,parameters)).records[0]!.get('comment');
  keys(event,{...commentKeys,ParentComment:true,ChildComments:true,Event:true,DiscussionChannel:true});commonKeys(event);
  keys(event.Event,{id:true});assert.equal(event.ChildComments.length,1);keys(event.ChildComments[0]!,{id:true,text:true});
  const channel=(await session.run<{DiscussionChannel:CustomCommentSectionChannel}>(getCommentSectionChannelQuery,parameters)).records[0]!.get('DiscussionChannel');
  keys(channel,{id:true,weightedVotesCount:true,discussionId:true,channelUniqueName:true,emoji:true,archived:true,locked:true,answered:true,
   UpvotedByUsers:true,UpvotedByUsersAggregate:true,UpvotedByUsersConnection:true,SuperUpvotedByUsers:true,CommentsAggregate:true,
   CommentsConnection:true,RootCommentsAggregate:true,RootCommentsConnection:true,SubscribedToNotifications:true,Answers:true,
   _detailAnswersHasNextPage:true,Channel:true,Discussion:true});
  keys(channel.Channel,{uniqueName:true,feedbackEnabled:true,imageUploadsEnabled:true,markdownImagesEnabled:true,emojiEnabled:true,Bots:true,Moderators:true});
  assert.equal(channel.Channel.Bots.length,1);keys(channel.Channel.Bots[0]!,{username:true,displayName:true,botProfileId:true,isDeprecated:true});
  assert.equal(channel.Channel.Moderators.length,1);keys(channel.Channel.Moderators[0]!,{displayName:true});
  keys(channel.Discussion,{id:true,title:true,Author:true});assert.ok(channel.Discussion.Author);
  keys(channel.Discussion.Author,{username:true,displayName:true,profilePicURL:true,commentKarma:true,createdAt:true,discussionKarma:true});
  assert.equal(channel.Answers.length,1);const answer=channel.Answers[0]!;keys(answer,{id:true,text:true,createdAt:true,CommentAuthor:true});
  assert.ok(answer.CommentAuthor);keys(answer.CommentAuthor,{username:true,displayName:true,__sourceAuthorType:true});
  assert.equal(answer.CommentAuthor.__sourceAuthorType,'ModerationProfile');
  for(const users of [channel.UpvotedByUsers,channel.SuperUpvotedByUsers,channel.SubscribedToNotifications]){assert.equal(users.length,1);keys(users[0]!,{username:true});}
  for(const count of [channel.UpvotedByUsersAggregate,channel.CommentsAggregate,channel.RootCommentsAggregate])keys(count,{count:true});
  for(const count of [channel.UpvotedByUsersConnection,channel.CommentsConnection,channel.RootCommentsConnection]){keys(count,{totalCount:true,aggregate:true});keys(count.aggregate,{count:true});keys(count.aggregate.count,{nodes:true});}
  canonicalRootComment(root);
  assert.ok(root.CommentAuthor);assert.deepEqual(authorSourceType(root.CommentAuthor),{found:true,value:'ModerationProfile'});
  assert.ok(!JSON.stringify(root).includes('__sourceAuthorType'));
 }finally{await session.close();}
});
for(const kind of ['section','replies','event'] as const)test(`${kind}: nested version and vote sources keep canonical aliases and counts`,async()=>{
 await richSources();
 const result=await execute(queries[kind](`PastVersions{body:id id:body Author{username}}
  SuperUpvotedByUsers{username} UpvotedByUsersConnection{aggregate:totalCount totalCount:aggregate{count{nodes}}}`));
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const id=kind==='replies'?'reply':'root';
 assert.deepEqual(items(result,kind),[{PastVersions:[{body:'version-'+id,id:'past '+id,Author:{username:'voter'}}],
  SuperUpvotedByUsers:[{username:'voter'}],UpvotedByUsersConnection:{aggregate:1,totalCount:{count:{nodes:1}}}}]);
});
test('comment-section bot maps retain their declared canonical identities under aliases',async()=>{
 await richSources();
 const result=await execute('{result:getCommentSection(discussionId:"discussion",channelUniqueName:"forum",modName:"Moderator",sort:"new"){DiscussionChannel{Channel{Bots{displayName:username username:displayName} Moderators{displayName}}}}}');
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)).result.DiscussionChannel.Channel,{Bots:[{displayName:'voter',username:'Voter display'}],Moderators:[{displayName:'Moderator'}]});
});
