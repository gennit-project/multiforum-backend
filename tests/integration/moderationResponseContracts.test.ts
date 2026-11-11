import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  schema = await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers,features:{filters:{String:{MATCHES:true}}}}).getSchema();
  registerGeneratedSchema(driver,schema);
  secured=applyMiddleware(schema,permissions);
}, {timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>{
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE (u:User {username:'actor',createdAt:datetime()}),
    (ch:Channel {uniqueName:'forum',wikiEnabled:true,createdAt:datetime()}),
    (mod:ModerationProfile {displayName:'ActorMod',createdAt:datetime()}),
    (role:ModChannelRole {name:'test-role',canDeleteWiki:true,canHideComment:true}),
    (w:WikiPage {id:'w',title:'Title',body:'Body',slug:'page',channelUniqueName:'forum',createdAt:datetime(),locked:false}),
    (:WikiPage {id:'w2',title:'Second',slug:'second',channelUniqueName:'forum',createdAt:datetime()}),
    (:ServerConfig {serverName:'server'}),
    (c:Comment {id:'c',text:'Text',createdAt:datetime(),isRootComment:true,isFeedbackComment:false,weightedVotesCount:2})
    CREATE (u)-[:ADMIN_OF_CHANNEL]->(ch) CREATE (ch)-[:OWNS_WIKI_PAGE]->(w)
    CREATE (u)-[:MODERATION_PROFILE]->(mod) CREATE (ch)-[:HAS_DEFAULT_MOD_ROLE]->(role)
    CREATE (ch)-[:HAS_COMMENT]->(c) CREATE (u)-[:AUTHORED_COMMENT]->(c)`);
});
function execute(source:string, secure=true, authenticated=true) {
  return graphql({schema:secure?secured:schema,source:`mutation { ${source} }`,contextValue:{driver,req:{headers:{}},user:authenticated?{username:'actor',email:null,email_verified:true,data:{ModerationProfile:{displayName:'ActorMod'}}}:undefined,mayAccessSensitiveContent:false}});
}
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const lockFields='id title body slug channelUniqueName locked lockedAt lockReason lockedByUsername';
const stickyFields='id isSticky stickyAt stickyByUsername';
async function property(label:string,key:string) {return (await driver.executeQuery(`MATCH(n:${label}) WHERE $id IS NULL OR n.id=$id RETURN n.${key} AS value`, {id: label === "WikiPage" ? "w" : null})).records[0].get('value');}

test('wiki lock/unlock serialize exact selected scalars and nullable metadata; repeats retain errors',async()=>{
  const locked=await execute(`lockWikiPage(channelUniqueName:"forum",wikiPageId:"w",reason:" reason "){${lockFields}}`);
  assert.equal(locked.errors,undefined);
  const result=plain(locked.data).lockWikiPage;
  assert.deepEqual({...result,lockedAt:'<time>'},{id:'w',title:'Title',body:'Body',slug:'page',channelUniqueName:'forum',locked:true,lockedAt:'<time>',lockReason:'reason',lockedByUsername:'actor'});
  assert.match(result.lockedAt,/^\d{4}-/);
  assert.equal(await property('WikiPage','locked'),true);
  assert.match((await execute('lockWikiPage(channelUniqueName:"forum",wikiPageId:"w",reason:"r"){id}')).errors?.[0].message??'',/already locked/);
  const unlocked=await execute(`unlockWikiPage(channelUniqueName:"forum",wikiPageId:"w"){${lockFields}}`);
  assert.equal(unlocked.errors,undefined);
  assert.deepEqual(plain(unlocked.data).unlockWikiPage,{id:'w',title:'Title',body:'Body',slug:'page',channelUniqueName:'forum',locked:false,lockedAt:null,lockReason:null,lockedByUsername:null});
  assert.match((await execute('unlockWikiPage(channelUniqueName:"forum",wikiPageId:"w"){id}')).errors?.[0].message??'',/not locked/);
});
test('wiki lock missing/disabled and permission failures keep non-null propagation without writes',async()=>{
  for(const source of ['lockWikiPage(channelUniqueName:"forum",wikiPageId:"missing",reason:"r"){id}','unlockWikiPage(channelUniqueName:"forum",wikiPageId:"missing"){id}']) {
    const result=await execute(source);assert.ok(result.errors);assert.equal(result.data,null);
  }
  await driver.executeQuery("MATCH(ch:Channel) SET ch.wikiEnabled=false");
  assert.match((await execute('lockWikiPage(channelUniqueName:"forum",wikiPageId:"w",reason:"r"){id}')).errors?.[0].message??'',/disabled/);
  await driver.executeQuery("MATCH(ch:Channel) SET ch.wikiEnabled=true WITH ch MATCH(:User)-[r:ADMIN_OF_CHANNEL]->(ch) DELETE r WITH ch MATCH(ch)-[:HAS_DEFAULT_MOD_ROLE]->(role) SET role.canDeleteWiki=false");
  assert.ok((await execute('lockWikiPage(channelUniqueName:"forum",wikiPageId:"w",reason:"r"){id}')).errors);
  assert.equal(await property('WikiPage','locked'),false);
});
test('wiki generated projection failure follows committed lock even for id-only outer selection',async()=>{
  await driver.executeQuery("MATCH(w:WikiPage {id:'w'}) REMOVE w.title");
  const result=await execute('lockWikiPage(channelUniqueName:"forum",wikiPageId:"w",reason:"r"){id}');
  assert.equal(result.data,null);assert.match(result.errors?.[0].message??'',/WikiPage.title/);
  assert.equal(await property('WikiPage','locked'),true);
});
test('pin/unpin scalar responses and repeated raw-schema calls retain idempotent writes',async()=>{
  // These two fields currently have no shield rule: secured API remains default-deny.
  for(const [name,expected] of [['pinWikiPageToChannel',1],['pinWikiPageToChannel',1],['unpinWikiPageFromChannel',0],['unpinWikiPageFromChannel',0]] as const) {
    const result=await execute(`${name}(channelUniqueName:"forum",wikiPageId:"w")`,false);assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data),{[name]:true});
    assert.equal(Number((await driver.executeQuery('MATCH ()-[r:PINNED_IN_CHANNEL]->() RETURN count(r) AS n')).records[0].get('n')),expected);
  }
  for(const name of ['pinWikiPageToChannel','unpinWikiPageFromChannel'])assert.ok((await execute(`${name}(channelUniqueName:"forum",wikiPageId:"w")`)).errors);
});
test('featured response retains ID order, repetition, empty array and validation errors',async()=>{
  for(const ids of [['w2','w'],['w2','w'],[]]) {
    const result=await execute(`setFeaturedWikiPages(serverName:"server",wikiPageIds:${JSON.stringify(ids)}){serverName featuredWikiPageIds}`,false);
    assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data),{setFeaturedWikiPages:{serverName:'server',featuredWikiPageIds:ids}});
  }
  for(const ids of [['w','w'],['missing']]) assert.ok((await execute(`setFeaturedWikiPages(serverName:"server",wikiPageIds:${JSON.stringify(ids)}){serverName}`,false)).errors);
  assert.deepEqual(await property('ServerConfig','featuredWikiPageIds'),[]);
});
test('sticky/unsticky serialize nullable metadata and retain repeat failures',async()=>{
  const result=await execute(`stickyComment(commentId:"c"){${stickyFields}}`);assert.equal(result.errors,undefined);
  const comment=plain(result.data).stickyComment;assert.equal(comment.id,'c');assert.equal(comment.isSticky,true);assert.equal(comment.stickyByUsername,'actor');assert.match(comment.stickyAt,/^\d{4}-/);
  assert.match((await execute('stickyComment(commentId:"c"){id}')).errors?.[0].message??'',/already stickied/);
  const undone=await execute(`unstickyComment(commentId:"c"){${stickyFields}}`);assert.equal(undone.errors,undefined);assert.deepEqual(plain(undone.data),{unstickyComment:{id:'c',isSticky:false,stickyAt:null,stickyByUsername:null}});
  assert.match((await execute('unstickyComment(commentId:"c"){id}')).errors?.[0].message??'',/not stickied/);
});
test('sticky missing/archived and malformed Boolean snapshots reject before writing',async()=>{
  for(const name of ['stickyComment','unstickyComment'])assert.ok((await execute(`${name}(commentId:"missing"){id}`,false)).errors);
  await driver.executeQuery("MATCH(c:Comment) SET c.archived=true");
  assert.match((await execute('stickyComment(commentId:"c"){id}',false)).errors?.[0].message??'',/archived/);
  await driver.executeQuery("MATCH(c:Comment) SET c.archived='bad'");
  assert.match((await execute('stickyComment(commentId:"c"){id}',false)).errors?.[0].message??'',/Boolean cannot represent/);
  assert.equal(await property('Comment','isSticky'),null);
});
test('soft delete response includes selected scalars, missing/nullable values and repeat effects',async()=>{
  const source='softDeleteComment(where:{id:{eq:"c"}}){comments{id text weightedVotesCount createdAt updatedAt}}';
  for(let i=0;i<2;i++) {
    const result=await execute(source,false);assert.equal(result.errors,undefined);
    const comment=plain(result.data).softDeleteComment.comments[0];assert.equal(comment.id,'c');assert.equal(comment.text,'[Deleted]');assert.equal(comment.weightedVotesCount,2);assert.match(comment.createdAt,/^\d{4}-/);assert.match(comment.updatedAt,/^\d{4}-/);
  }
  assert.equal(Number((await driver.executeQuery('MATCH ()-[r:AUTHORED_COMMENT]->(:Comment) RETURN count(r) AS n')).records[0].get('n')),0);
  const missing=await execute('softDeleteComment(where:{id:{eq:"missing"}}){comments{id}}',false);assert.equal(missing.errors,undefined);assert.deepEqual(plain(missing.data),{softDeleteComment:{comments:[]}});
  await driver.executeQuery('MATCH(c:Comment) REMOVE c.weightedVotesCount');
  assert.equal(plain((await execute(source,false)).data).softDeleteComment.comments[0].weightedVotesCount,null);
});
test('soft delete malformed post-write projection keeps committed text and author removal',async()=>{
  await driver.executeQuery('MATCH(c:Comment) REMOVE c.createdAt');
  const result=await execute('softDeleteComment(where:{id:{eq:"c"}}){comments{id}}',false);assert.equal(result.data,null);assert.match(result.errors?.[0].message??'',/Comment.createdAt/);
  assert.equal(await property('Comment','text'),'[Deleted]');
  assert.equal(Number((await driver.executeQuery('MATCH ()-[r:AUTHORED_COMMENT]->(:Comment) RETURN count(r) AS n')).records[0].get('n')),0);
});
test('all eight operations retain secured anonymous denial',async()=>{
  for(const source of ['lockWikiPage(channelUniqueName:"forum",wikiPageId:"w",reason:"r"){id}','unlockWikiPage(channelUniqueName:"forum",wikiPageId:"w"){id}','pinWikiPageToChannel(channelUniqueName:"forum",wikiPageId:"w")','unpinWikiPageFromChannel(channelUniqueName:"forum",wikiPageId:"w")','setFeaturedWikiPages(serverName:"server",wikiPageIds:[]){serverName}','stickyComment(commentId:"c"){id}','unstickyComment(commentId:"c"){id}','softDeleteComment(where:{id:{eq:"c"}}){comments{id}}'])assert.ok((await execute(source,true,false)).errors,source);
  assert.equal(await property('Comment','text'),'Text');assert.equal(await property('WikiPage','locked'),false);
});

// Evidence for the remaining raw Issue boundary: validating every property
// eagerly would change id-only requests and move errors inside resolver catches.
test('raw Issue completion depends on selected fields after committed lock writes',async()=>{
  await driver.executeQuery("CREATE (:Issue {id:'issue',issueNumber:1,title:'Issue',body:['not','a scalar'],channelUniqueName:'forum',createdAt:datetime(),locked:false})");
  const locked=await execute('lockIssue(issueId:"issue",reason:"reason"){id}',false);
  assert.equal(locked.errors,undefined);assert.deepEqual(plain(locked.data),{lockIssue:{id:'issue'}});
  const unlocked=await execute('unlockIssue(issueId:"issue",reason:"reason"){id body}',false);
  assert.deepEqual(plain(unlocked.data),{unlockIssue:{id:'issue',body:null}});
  assert.deepEqual(unlocked.errors?.[0].path,['unlockIssue','body']);
  assert.match(unlocked.errors?.[0].message??'',/String cannot represent/);
  assert.equal(await property('Issue','locked'),false);
});
