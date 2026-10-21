import originalPosterSuspended from "../../customResolvers/queries/isOriginalPosterSuspended.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createIssueTargetRepository, type IssueTargetRepository } from "../../services/persistence/issueTargetRepository.js";
import { resolveIssueTarget } from "../../customResolvers/shared/resolveIssueTarget.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
before(async()=>{
 driver=await startNeo4j();const app=getCustomResolvers(driver);ogm=app.ogm;
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:true}});
 const schema=await neoSchema.getSchema();registerGeneratedSchema(driver,schema);initializeOgmFromExistingSchema(ogm,neoSchema,schema);
},{timeout:240_000});
beforeEach(async()=>resetDatabase(driver));after(async()=>stopNeo4j());
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const outcome=async(fn:()=>Promise<unknown>)=>{try{return {value:plain(await fn())};}catch(error){return {error:(error as Error).message};}};
const compare=async(old:()=>Promise<unknown>,current:()=>Promise<unknown>)=>assert.deepEqual(await outcome(current),await outcome(old));
const legacySelections = {
  "owner": "{ username }",
  "issue": "{\n      id\n      channelUniqueName\n      relatedDiscussionId\n      relatedEventId\n      relatedCommentId\n      relatedWikiPageId\n      relatedWikiRevisionId\n      relatedUsername\n      relatedModProfileName\n      Channel { uniqueName }\n      TargetDiscussion { id }\n      TargetEvent { id }\n      TargetComment { id }\n      TargetWikiPage { id }\n      TargetWikiRevision { id }\n      TargetUser { username isBot }\n      TargetModProfile { displayName }\n    }",
  "user": "{ username isBot }",
  "discussion": "{ id Author { username isBot } }",
  "event": "{ id Poster { username isBot } }",
  "comment": "{\n        id\n        CommentAuthor {\n          ... on User { username isBot }\n          ... on ModerationProfile { displayName }\n        }\n      }",
  "revision": "{ id Author { username isBot } }",
  "wiki": "{\n        id\n        OriginalAuthor { username isBot }\n        VersionAuthor { username isBot }\n      }"
};
const oldRepository=():IssueTargetRepository=>({
 findProfileOwner: displayName=>ogm.model("User").find({where:{ModerationProfile:{displayName}},selectionSet:legacySelections.owner}),
 findIssue:id=>ogm.model("Issue").find({where:{id},selectionSet:legacySelections.issue}),
 findDirectUser:username=>ogm.model("User").find({where:{username},selectionSet:legacySelections.user}),
 findDiscussionAuthor:id=>ogm.model("Discussion").find({where:{id},selectionSet:legacySelections.discussion}),
 findEventPoster:id=>ogm.model("Event").find({where:{id},selectionSet:legacySelections.event}),
 findCommentAuthor:id=>ogm.model("Comment").find({where:{id},selectionSet:legacySelections.comment}),
 findRevisionAuthor:id=>ogm.model("TextVersion").find({where:{id},selectionSet:legacySelections.revision}),
 findWikiAuthors:id=>ogm.model("WikiPage").find({where:{id},selectionSet:legacySelections.wiki}),
});
const argsByMethod:Record<keyof IssueTargetRepository,string>={findProfileOwner:"Moderator",findIssue:"i",findDirectUser:"alice",findDiscussionAuthor:"d",findEventPoster:"e",findCommentAuthor:"c",findRevisionAuthor:"r",findWikiAuthors:"w"};
const compareAll=async()=>{
 const old=oldRepository(),repo=createIssueTargetRepository(driver);
 for(const method of Object.keys(argsByMethod) as Array<keyof IssueTargetRepository>)await compare(()=>old[method](argsByMethod[method]),()=>repo[method](argsByMethod[method]));
};
const resolveBoth=async(options:Partial<Parameters<typeof resolveIssueTarget>[0]>={})=>{
 const base={issueId:"i",...options};
 await compare(()=>resolveIssueTarget({...base,repository:oldRepository()}),()=>resolveIssueTarget({...base,repository:createIssueTargetRepository(driver)}));
 return resolveIssueTarget({...base,repository:createIssueTargetRepository(driver)});
};
const seed=async()=>driver.executeQuery(`
 CREATE (ch:Channel {uniqueName:'cats'})
 CREATE (a:User {username:'alice',isBot:false}), (b:User {username:'bob',isBot:true}), (m:ModerationProfile {displayName:'Moderator'})
 CREATE (a)-[:MODERATION_PROFILE]->(m)
 CREATE (d:Discussion {id:'d'}), (e:Event {id:'e'}), (c:Comment {id:'c'}), (r:TextVersion {id:'r'}), (w:WikiPage {id:'w'})
 CREATE (a)-[:POSTED_DISCUSSION]->(d), (b)-[:POSTED_BY]->(e), (a)-[:AUTHORED_COMMENT]->(c), (b)-[:AUTHORED_VERSION]->(r)
 CREATE (a)-[:AUTHORED_WIKI_PAGE]->(w), (b)-[:AUTHORED_VERSION]->(w)
 CREATE (i:Issue {id:'i',channelUniqueName:'wrong-scalar',relatedDiscussionId:'old-d'})
 CREATE (ch)-[:HAS_ISSUE]->(i), (i)-[:TARGETS_DISCUSSION]->(d)
`);
test("all eight fixed snapshots match missing and populated generated reads",async()=>{
 await compareAll();await seed();await compareAll();
 const repo=createIssueTargetRepository(driver);assert.equal((await repo.findEventPoster("e"))[0].Poster?.username,"bob");assert.equal((await repo.findRevisionAuthor("r"))[0].Author?.username,"bob");assert.equal((await repo.findCommentAuthor("c"))[0].CommentAuthor && "username" in (await repo.findCommentAuthor("c"))[0].CommentAuthor!,true);
});
test("relationship identity wins and channel scope never falls back to scalar",async()=>{
 await seed();const target=await resolveBoth();assert.equal(target.username,"alice");assert.equal(target.channelUniqueName,"cats");
 await driver.executeQuery("MATCH (:Channel)-[r:HAS_ISSUE]->(:Issue) DELETE r");
 await assert.rejects(resolveBoth(),/Could not find the user account name/);
});
test("direct moderator and user targets preserve precedence and bot values",async()=>{
 await seed();await driver.executeQuery("MATCH (i:Issue),(m:ModerationProfile),(u:User {username:'bob'}) SET i.relatedUsername='alice', i.relatedModProfileName='old-mod' CREATE (i)-[:TARGETS_MOD_PROFILE]->(m), (i)-[:TARGETS_USER]->(u)");
 const mod=await resolveBoth();assert.equal(mod.modProfileName,"Moderator");assert.equal(mod.username,"alice");assert.equal(mod.isBot,false);
 const user=await resolveBoth({suspendedEntityName:"user"});assert.equal(user.username,"bob");assert.equal(user.isBot,true);
});
test("comment union resolves moderator ownership and preserves absent owner",async()=>{
 await seed();await driver.executeQuery("MATCH (i:Issue),(c:Comment),(m:ModerationProfile),(a:User)-[r:AUTHORED_COMMENT]->(c) DELETE r SET i.relatedCommentId='c' CREATE (m)-[:AUTHORED_COMMENT]->(c)");
 await compareAll();const target=await resolveBoth();assert.equal(target.modProfileName,"Moderator");assert.equal(target.username,"alice");
 await driver.executeQuery("MATCH ()-[r:MODERATION_PROFILE]->() DELETE r");assert.equal((await resolveBoth()).username,undefined);
});
test("sequential legacy content and optional revision/wiki fallbacks retain null overwrites",async()=>{
 await seed();await driver.executeQuery("MATCH (i:Issue) SET i.relatedEventId='e',i.relatedCommentId='c',i.relatedWikiRevisionId='r',i.relatedWikiPageId='w'");
 assert.equal((await resolveBoth()).username,"alice");assert.equal((await resolveBoth({includeTextVersion:true,includeWikiPage:true})).username,"bob");
 await driver.executeQuery("MATCH (u:User)-[r:AUTHORED_VERSION]->(:TextVersion) DELETE r");assert.equal((await resolveBoth({includeTextVersion:true,includeWikiPage:true})).username,"alice");
 await driver.executeQuery("MATCH (u:User)-[r:AUTHORED_WIKI_PAGE]->(:WikiPage) DELETE r");assert.equal((await resolveBoth({includeTextVersion:true,includeWikiPage:true})).username,"bob");
 await assert.rejects(resolveBoth({includeTextVersion:true}),/Could not find/);
});
test("anonymous internal filtering applies to roots and nested issue targets",async()=>{
 await seed();await driver.executeQuery("MATCH (d:Discussion) SET d.hasSensitiveContent=true");await compareAll();assert.deepEqual(await createIssueTargetRepository(driver).findDiscussionAuthor("d"),[]);
 assert.equal((await createIssueTargetRepository(driver).findIssue("i"))[0].TargetDiscussion,null);
 await driver.executeQuery("MATCH (n) WHERE n:Issue OR n:Comment OR n:TextVersion SET n.ageGateRestricted=true");await compareAll();assert.deepEqual(await createIssueTargetRepository(driver).findIssue("i"),[]);
});
test("invalid arguments and selected scalars retain generated first errors",async()=>{
 await seed();const old=oldRepository(),repo=createIssueTargetRepository(driver);
 for(const key of Object.keys(argsByMethod) as Array<keyof IssueTargetRepository>)await compare(()=>old[key](true as never),()=>repo[key](true as never));
 await driver.executeQuery("MATCH (u:User) SET u.isBot='invalid'");await compareAll();
 assert.ok((await outcome(()=>repo.findDirectUser("alice"))).error);
});
test("default result limits remain generated defaults for repeated target IDs",async()=>{
 await driver.executeQuery("UNWIND range(1,30) AS n CREATE (:Discussion {id:'d'}) CREATE (:Comment {id:'c'}) CREATE (:TextVersion {id:'r'})");await compareAll();const repo=createIssueTargetRepository(driver);
 assert.equal((await repo.findDiscussionAuthor("d")).length,25);assert.equal((await repo.findCommentAuthor("c")).length,25);assert.equal((await repo.findRevisionAuthor("r")).length,25);
});

test("read snapshots leave the graph unchanged and query callers do not inherit privileged JWT",async()=>{
 await seed();
 const snapshot=async()=>plain((await driver.executeQuery("MATCH (n) WITH n ORDER BY elementId(n) RETURN collect({labels:labels(n),props:properties(n)}) AS nodes")).records[0].get("nodes"));
 const before=await snapshot();await compareAll();await resolveBoth();assert.deepEqual(await snapshot(),before);
 await driver.executeQuery("MATCH (i:Issue) SET i.ageGateRestricted=true");
 const context={driver,ogm,mayAccessSensitiveContent:true,jwt:{mayAccessSensitiveContent:true}} as GraphQLContext;
 await assert.rejects(originalPosterSuspended({})(null,{issueId:"i"},context,{} as GraphQLResolveInfo),{message:"Issue not found"});
});
test("actual suspension query consumes target snapshots with unchanged active/expired results",async()=>{
 await seed();const query=originalPosterSuspended({});
 const context={driver,ogm,mayAccessSensitiveContent:true} as GraphQLContext;
 const check=async(expected:boolean)=>{
   const previous=await query(null,{issueId:"i"},{...context,issueTargetRepository:oldRepository()},{} as GraphQLResolveInfo);
   assert.equal(await query(null,{issueId:"i"},context,{} as GraphQLResolveInfo),previous);assert.equal(previous,expected);
 };
 await check(false);
 await driver.executeQuery("MATCH (ch:Channel {uniqueName:'cats'}),(u:User {username:'alice'}) CREATE (s:Suspension {id:'s',username:'alice',suspendedIndefinitely:true}) CREATE (ch)-[:SUSPENDED_AS_USER]->(s),(u)-[:SUSPENDED_AS_USER]->(s)");await check(true);
 await driver.executeQuery("MATCH (s:Suspension) SET s.suspendedIndefinitely=false,s.suspendedUntil=datetime('2020-01-01T00:00:00Z')");await check(false);
});
