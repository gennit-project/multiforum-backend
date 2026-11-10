import {getDiscussionDetailCoreQuery,getDiscussionDetailChannelQuery,getDiscussionDetailFilesQuery,getDiscussionDetailAnswersPageQuery,getDiscussionDetailFilesPageQuery,getDiscussionDetailImagesPageQuery} from '../../customResolvers/cypher/cypherQueries.js';
import type {DetailCore,DetailChannel,DetailFile,DetailImage} from '../../customResolvers/contracts/discussionDetailSources.js';
import type {CustomChannelAnswer} from '../../customResolvers/contracts/customCommentSources.js';
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import {graphql,type GraphQLSchema} from 'graphql';
import {applyMiddleware} from 'graphql-middleware';
import type {Driver} from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import middleware from '../../middleware/userChildIdentityMiddleware.js';
import permissions from '../../permissions.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver,schema:GraphQLSchema;
before(async()=>{driver=await startNeo4j();const raw=await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema();schema=applyMiddleware(raw,middleware,permissions);},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{await resetDatabase(driver);await driver.executeQuery(`CREATE(ch:Channel{uniqueName:'forum',displayName:'Forum'}),(d:Discussion{id:'d',title:'Title'}),
 (dc:DiscussionChannel{id:'dc',discussionId:'d',channelUniqueName:'forum'}),(a:Comment{id:'answer',text:'Answer',createdAt:datetime()}),(m:ModerationProfile),
 (dc)-[:POSTED_IN_CHANNEL]->(d),(dc)-[:POSTED_IN_CHANNEL]->(ch),(a)-[:IS_REPLY_TO]->(dc),(m)-[:AUTHORED_COMMENT]->(a),
 (u:User{username:'human'}),(u)-[:MODERATION_PROFILE]->(m)`);});
const run=(source:string,variableValues?:Record<string,unknown>,username:string|null=null)=>graphql({schema,source,variableValues,contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:false,user:username?{username,email:null,email_verified:true,data:null}:null}});
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const queries={
 initial:(fields:string)=>`{result:getDiscussionDetail(discussionId:"d",channelUniqueName:"forum"){DiscussionChannels{Answers{${fields}}}}}`,
 page:(fields:string)=>`{result:getDiscussionDetailAnswers(discussionId:"d",channelUniqueName:"forum"){answers{${fields}}}}`,
};
for(const kind of ['initial','page'] as const)test(`${kind} detail answers retain moderator type without displayName`,async()=>{
 const result=await run(queries[kind]('CommentAuthor{__typename}'));assert.equal(result.errors,undefined);
 const data=plain(result.data).result;
 assert.deepEqual(kind==='initial'?data[0].DiscussionChannels[0].Answers:data.answers,[{CommentAuthor:{__typename:'ModerationProfile'}}]);
});
test('detail core scalar aliases retain owned projection values',async()=>{
 const result=await run('{getDiscussionDetail(discussionId:"d",channelUniqueName:"forum"){id:title title:id}}');
 assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data),{getDiscussionDetail:[{id:'Title',title:'d'}]});
});
for(const kind of ['initial','page'] as const){
 test(`${kind} detail answer denies the moderator's human account`,async()=>{
  const result=await run(queries[kind]('CommentAuthor{... on ModerationProfile{hidden:User{username}}}'));
  assert.ok(result.errors?.some(error=>error.path?.includes('hidden')));
  assert.ok(!JSON.stringify(result.data).includes('human'));
  assert.ok(!JSON.stringify(result.data).includes('__sourceAuthorType'));
 });
 test(`${kind} detail answer retains nullable author`,async()=>{
  await driver.executeQuery('MATCH()-[r:AUTHORED_COMMENT]->() DELETE r');
  const result=await run(queries[kind]('CommentAuthor{__typename}'));assert.equal(result.errors,undefined);
  const data=plain(result.data).result;
  assert.deepEqual(kind==='initial'?data[0].DiscussionChannels[0].Answers:data.answers,[{CommentAuthor:null}]);
 });
 test(`${kind} detail answer ambiguity is lazy under fragment directives`,async()=>{
  await driver.executeQuery('MATCH(m:ModerationProfile) SET m:User');
  const source='query($show:Boolean!)'+queries[kind]('...Fields')+' fragment Fields on Comment { id CommentAuthor @include(if:$show){__typename} }';
  assert.equal((await run(source,{show:false})).errors,undefined);
  assert.ok((await run(source,{show:true})).errors?.length);
 });
 test(`${kind} detail answer canonical aliases preserve user fields`,async()=>{
  await driver.executeQuery("MATCH(m:ModerationProfile)-[r:AUTHORED_COMMENT]->(a) DELETE r CREATE(u:User{username:'alice',displayName:'Alice'}),(u)-[:AUTHORED_COMMENT]->(a)");
  const result=await run(queries[kind]('text:id id:text CommentAuthor{... on User{username:displayName displayName:username}}'));
  assert.equal(result.errors,undefined);
  const data=plain(result.data).result;
  assert.deepEqual(kind==='initial'?data[0].DiscussionChannels[0].Answers:data.answers,[{text:'answer',id:'Answer',CommentAuthor:{username:'Alice',displayName:'alice'}}]);
 });
 test(`${kind} detail answer malformed text fails only when selected`,async()=>{
  await driver.executeQuery("MATCH(a:Comment) SET a.text=['invalid']");
  assert.equal((await run(queries[kind]('id'))).errors,undefined);
  const result=await run(queries[kind]('bad:text'));assert.ok(result.errors?.some(error=>error.path?.includes('bad')));
 });
 test(`${kind} detail answer respects age-gate filtering`,async()=>{
  await driver.executeQuery('MATCH(a:Comment) SET a.ageGateRestricted=true');
  const result=await run(queries[kind]('id'));assert.equal(result.errors,undefined);
  const data=plain(result.data).result;
  assert.deepEqual(kind==='initial'?data[0].DiscussionChannels[0].Answers:data.answers,[]);
 });
}
async function seedAssets(){
 await driver.executeQuery(`MATCH(d:Discussion{id:'d'}),(dc:DiscussionChannel{id:'dc'})
 CREATE(u:User{username:'alice',displayName:'Alice'}),(u)-[:POSTED_DISCUSSION]->(d),
 (album:Album{id:'album',imageOrder:['image']}),(d)-[:HAS_ALBUM]->(album),
 (img:Image{id:'image',url:'url',alt:'alt',createdAt:datetime()}),(album)-[:HAS_IMAGE]->(img),(u)-[:UPLOADED_IMAGE]->(img),
 (f:DownloadableFile{id:'file',fileName:'File',createdAt:datetime()}),(d)-[:HAS_DOWNLOADABLE_FILE]->(f),
 (l:License{id:'license',name:'License'}),(f)-[:USES_LICENSE]->(l),
 (tag:Tag{text:'topic'}),(d)-[:HAS_TAG]->(tag),
 (flair:DiscussionFlair{id:'flair',displayName:'Flair',order:1}),(dc)-[:HAS_DISCUSSION_FLAIR]->(flair),
 (option:FilterOption{id:'option',value:'value',displayName:'Option',order:1}),(dc)-[:HAS_LABEL_OPTION]->(option),
 (group:FilterGroup{id:'group',key:'key',displayName:'Group'}),(group)-[:HAS_FILTER_OPTION]->(option)`);
}
test('detail fixed assets and channels retain nested aliases',async()=>{
 await seedAssets();
 const result=await run('{getDiscussionDetail(discussionId:"d",channelUniqueName:"forum"){Author{username:displayName displayName:username} Album{Images{url:alt alt:url Uploader{username:displayName}}} Tags{text} DownloadableFiles{fileName:id id:fileName license{id:name name:id}} DiscussionChannels{Channel{uniqueName:displayName} Flairs{id:displayName} LabelOptions{id:value group{id:key}} comments:CommentsConnection{n:totalCount aggregate{count{nodes}}}}}}');
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 const data=plain(result.data).getDiscussionDetail[0];
 assert.deepEqual(data.Author,{username:'Alice',displayName:'alice'});
 assert.deepEqual(data.Album,{Images:[{url:'alt',alt:'url',Uploader:{username:'Alice'}}]});
 assert.deepEqual(data.DownloadableFiles,[{fileName:'file',id:'File',license:{id:'License',name:'license'}}]);
 assert.deepEqual(data.DiscussionChannels,[{Channel:{uniqueName:'Forum'},Flairs:[{id:'Flair'}],LabelOptions:[{id:'value',group:{id:'key'}}],comments:{n:0,aggregate:{count:{nodes:0}}}}]);
});
test('detail image and file pages retain nested source aliases',async()=>{
 await seedAssets();
 const result=await run('{getDiscussionDetailImages(discussionId:"d",channelUniqueName:"forum"){images{url:alt alt:url Uploader{username:displayName}}} getDiscussionDetailFiles(discussionId:"d",channelUniqueName:"forum"){files{fileName:id id:fileName license{id:name name:id}}}}');
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{getDiscussionDetailImages:{images:[{url:'alt',alt:'url',Uploader:{username:'Alice'}}]},getDiscussionDetailFiles:{files:[{fileName:'file',id:'File',license:{id:'License',name:'license'}}]}});
});
const keys=(value:object,expected:readonly string[])=>assert.deepEqual(Object.keys(value).sort(),[...expected].sort());
const authorKeys=['username','displayName','__sourceAuthorType'];
const imageKeys=['id','createdAt','url','alt','caption','copyright','Uploader'];
const fileKeys=['id','createdAt','fileName','url','kind','size','priceModel','priceCents','priceCurrency','downloadCountTotal','downloadCountUnique','attributionOverride','supportPatreonUrl','supportBuyMeACoffeeUrl','supportKoFiUrl','supportPayPalMeUrl','scanStatus','scanCheckedAt','scanReason','uploadedByUsername','license'];
test('all six actual detail queries preserve exact nested owned projections',async()=>{
 await seedAssets();
 await driver.executeQuery(`MATCH(d:Discussion{id:'d'}),(u:User{username:'alice'}),(album:Album),(ch:Channel)
 CREATE(cross:Discussion{id:'cross'}),(d)-[:CROSSPOSTED_DISCUSSION]->(cross),(cross)-[:HAS_ALBUM]->(album),(u)-[:POSTED_DISCUSSION]->(cross),
 (dc:DiscussionChannel{channelUniqueName:'forum'}),(dc)-[:POSTED_IN_CHANNEL]->(cross),(dc)-[:POSTED_IN_CHANNEL]->(ch),
 (collection:Collection{id:'collection',name:'Collection',visibility:'PUBLIC'}),(d)-[:SHARES_COLLECTION]->(collection),(collection)-[:CREATED_BY]->(u)`);
 const params={discussionId:'d',channelUniqueName:'forum',viewerUsername:null,viewerModName:null,mayAccessSensitiveContent:false,imageLimit:12,previewImageLimit:12,answerLimit:5,fileLimit:12,cursorCreatedAt:null,cursorId:null,pageLimit:6};
 const session=driver.session();try{
  const core=(await session.run<{Discussion:DetailCore}>(getDiscussionDetailCoreQuery,params)).records[0].get('Discussion');
  keys(core,['id','title','body','createdAt','updatedAt','hasDownload','hasSensitiveContent','Author','Album','Tags','FeedbackCommentsAggregate','FeedbackCommentsConnection','FeedbackComments','CrosspostedDiscussion','SharedCollection','isFavorited']);
  assert.ok(core.Author);keys(core.Author,['username','displayName','profilePicURL','createdAt','discussionKarma','commentKarma']);
  assert.ok(core.Album);keys(core.Album,['id','imageOrder','Images','_detailImagesHasNextPage']);keys(core.Album.Images[0],imageKeys);
  assert.ok(core.Album.Images[0].Uploader);keys(core.Album.Images[0].Uploader,['username','displayName']);keys(core.Tags[0],['text']);
  assert.ok(core.CrosspostedDiscussion);keys(core.CrosspostedDiscussion,['id','title','body','createdAt','Author','Album','DiscussionChannels']);
  const cross=core.CrosspostedDiscussion;assert.ok(cross.Author);keys(cross.Author,['username','displayName','profilePicURL']);
  assert.ok(cross.Album);keys(cross.Album,['id','imageOrder','Images']);keys(cross.Album.Images[0],imageKeys.filter(key=>key!=='createdAt'));
  keys(cross.DiscussionChannels[0],['channelUniqueName','Channel']);assert.ok(cross.DiscussionChannels[0].Channel);keys(cross.DiscussionChannels[0].Channel,['uniqueName','displayName']);
  assert.ok(core.SharedCollection);keys(core.SharedCollection,['id','name','description','collectionType','visibility','itemCount','CreatedBy']);
  assert.ok(core.SharedCollection.CreatedBy);keys(core.SharedCollection.CreatedBy,['username','displayName','profilePicURL']);
  const channel=(await session.run<{DiscussionChannel:DetailChannel}>(getDiscussionDetailChannelQuery,params)).records[0].get('DiscussionChannel');
  keys(channel,['id','discussionId','channelUniqueName','weightedVotesCount','archived','answered','locked','emoji','Flairs','UpvotedByUsers','UpvotedByUsersAggregate','UpvotedByUsersConnection','SuperUpvotedByUsers','CommentsAggregate','CommentsConnection','Answers','_detailAnswersHasNextPage','LabelOptions','Discussion','Channel']);
  keys(channel.Channel,['uniqueName','channelIconURL','displayName','feedbackEnabled','imageUploadsEnabled','markdownImagesEnabled','emojiEnabled']);keys(channel.Discussion,['id']);
  keys(channel.Answers[0],['id','text','createdAt','CommentAuthor']);assert.ok(channel.Answers[0].CommentAuthor);keys(channel.Answers[0].CommentAuthor,authorKeys);assert.equal(channel.Answers[0].CommentAuthor.__sourceAuthorType,'ModerationProfile');
  keys(channel.Flairs[0],['id','channelUniqueName','displayName','color','order','archived']);keys(channel.LabelOptions[0],['id','value','displayName','order','group']);assert.ok(channel.LabelOptions[0].group);keys(channel.LabelOptions[0].group,['id','key','displayName']);
  for(const count of [core.FeedbackCommentsConnection,channel.UpvotedByUsersConnection,channel.CommentsConnection]){keys(count,['totalCount','aggregate']);keys(count.aggregate,['count']);keys(count.aggregate.count,['nodes']);assert.equal(count.totalCount.toNumber(),0);}
  const files=(await session.run<{DownloadableFiles:DetailFile[];detailFilesHasNextPage:boolean}>(getDiscussionDetailFilesQuery,params)).records[0];
  keys(files.get('DownloadableFiles')[0],fileKeys);assert.equal(files.get('detailFilesHasNextPage'),false);
  const answer=(await session.run<{item:CustomChannelAnswer}>(getDiscussionDetailAnswersPageQuery,params)).records[0].get('item');keys(answer,['id','text','createdAt','CommentAuthor']);assert.ok(answer.CommentAuthor);keys(answer.CommentAuthor,authorKeys);
  const file=(await session.run<{item:DetailFile}>(getDiscussionDetailFilesPageQuery,params)).records[0].get('item');keys(file,fileKeys);assert.ok(file.license);keys(file.license,['id','name']);
  const image=(await session.run<{item:DetailImage}>(getDiscussionDetailImagesPageQuery,params)).records[0].get('item');keys(image,imageKeys);assert.ok(image.Uploader);keys(image.Uploader,['username','displayName']);
 }finally{await session.close();}
});
for(const source of [
 '{getDiscussionDetail(discussionId:"d",channelUniqueName:"forum"){Author{hidden:Email{address}}}}',
 '{getDiscussionDetailImages(discussionId:"d",channelUniqueName:"forum"){images{Uploader{hidden:Email{address}}}}}',
])test(`detail User source retains protected child identity: ${source.includes('Images')?'uploader':'author'}`,async()=>{
 await seedAssets();
 const owner=await run(source,undefined,'alice');assert.equal(owner.errors,undefined,JSON.stringify(owner.errors));
 assert.ok(!JSON.stringify(owner.data).includes('username'));
 const outsider=await run(source,undefined,'outsider');assert.ok(outsider.errors?.some(error=>error.path?.includes('hidden')));
 await driver.executeQuery("MATCH(u:User{username:'alice'}) SET u.username=17");
 const malformed=await run(source,undefined,'17');assert.ok(malformed.errors?.some(error=>error.path?.includes('hidden')));
});
test('detail crosspost and shared collection sources preserve nested aliases',async()=>{
 await seedAssets();
 await driver.executeQuery(`MATCH(d:Discussion{id:'d'}),(u:User{username:'alice'}),(album:Album),(ch:Channel)
 CREATE(cross:Discussion{id:'cross',title:'Cross'}),(d)-[:CROSSPOSTED_DISCUSSION]->(cross),(cross)-[:HAS_ALBUM]->(album),(u)-[:POSTED_DISCUSSION]->(cross),
 (dc:DiscussionChannel{channelUniqueName:'forum'}),(dc)-[:POSTED_IN_CHANNEL]->(cross),(dc)-[:POSTED_IN_CHANNEL]->(ch),
 (collection:Collection{id:'collection',name:'Collection',visibility:'PUBLIC'}),(d)-[:SHARES_COLLECTION]->(collection),(collection)-[:CREATED_BY]->(u)`);
 const result=await run('{getDiscussionDetail(discussionId:"d",channelUniqueName:"forum"){CrosspostedDiscussion{id:title title:id Author{username:displayName} Album{Images{url:alt Uploader{username:displayName}}} DiscussionChannels{Channel{uniqueName:displayName}}} SharedCollection{id:name name:id CreatedBy{username:displayName}}}}');
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(plain(result.data),{getDiscussionDetail:[{CrosspostedDiscussion:{id:'Cross',title:'cross',Author:{username:'Alice'},Album:{Images:[{url:'alt',Uploader:{username:'Alice'}}]},DiscussionChannels:[{Channel:{uniqueName:'Forum'}}]},SharedCollection:{id:'Collection',name:'collection',CreatedBy:{username:'Alice'}}}]});
});
