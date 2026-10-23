import originalPosterSuspended from "../../customResolvers/queries/isOriginalPosterSuspended.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import assert from "node:assert/strict";
import { after, before, beforeEach, test, type TestContext } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createIssueTargetRepository, type IssueTargetRepository } from "../../services/persistence/issueTargetRepository.js";
import { resolveIssueTarget } from "../../customResolvers/shared/resolveIssueTarget.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
before(async()=>{
 driver=await startNeo4j();const app=getCustomResolvers(driver);
 const neoSchema=new Neo4jGraphQL({typeDefs,driver,resolvers:app.resolvers,features:{filters:{String:{MATCHES:true}},subscriptions:true}});
 const schema=await neoSchema.getSchema();registerGeneratedSchema(driver,schema);
},{timeout:240_000});
beforeEach(async()=>resetDatabase(driver));after(async()=>stopNeo4j());
const plain=(x:unknown)=>JSON.parse(JSON.stringify(x));
const outcome=async(fn:()=>Promise<unknown>)=>{try{return {value:plain(await fn())};}catch(error){return {error:(error as Error).message};}};
const argsByMethod:Record<keyof IssueTargetRepository,string>={findProfileOwner:"Moderator",findIssue:"i",findDirectUser:"alice",findDiscussionAuthor:"d",findEventPoster:"e",findCommentAuthor:"c",findRevisionAuthor:"r",findWikiAuthors:"w"};
const snapshotAll=async(t:TestContext)=>{
 const repo=createIssueTargetRepository(driver);
 for(const method of Object.keys(argsByMethod) as Array<keyof IssueTargetRepository>)t.assert.snapshot(await outcome(()=>repo[method](argsByMethod[method])));
};
const resolveTarget=async(options:Partial<Parameters<typeof resolveIssueTarget>[0]>={})=>
 resolveIssueTarget({issueId:"i",...options,repository:createIssueTargetRepository(driver)});
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
test("all eight fixed snapshots match missing and populated generated reads",async(t)=>{
 await snapshotAll(t);await seed();await snapshotAll(t);
 const repo=createIssueTargetRepository(driver);assert.equal((await repo.findEventPoster("e"))[0].Poster?.username,"bob");assert.equal((await repo.findRevisionAuthor("r"))[0].Author?.username,"bob");assert.equal((await repo.findCommentAuthor("c"))[0].CommentAuthor && "username" in (await repo.findCommentAuthor("c"))[0].CommentAuthor!,true);
});
test("relationship identity wins and channel scope never falls back to scalar",async()=>{
 await seed();const target=await resolveTarget();assert.equal(target.username,"alice");assert.equal(target.channelUniqueName,"cats");
 await driver.executeQuery("MATCH (:Channel)-[r:HAS_ISSUE]->(:Issue) DELETE r");
 await assert.rejects(resolveTarget(),/Could not find the user account name/);
});
test("direct moderator and user targets preserve precedence and bot values",async()=>{
 await seed();await driver.executeQuery("MATCH (i:Issue),(m:ModerationProfile),(u:User {username:'bob'}) SET i.relatedUsername='alice', i.relatedModProfileName='old-mod' CREATE (i)-[:TARGETS_MOD_PROFILE]->(m), (i)-[:TARGETS_USER]->(u)");
 const mod=await resolveTarget();assert.equal(mod.modProfileName,"Moderator");assert.equal(mod.username,"alice");assert.equal(mod.isBot,false);
 const user=await resolveTarget({suspendedEntityName:"user"});assert.equal(user.username,"bob");assert.equal(user.isBot,true);
});
test("comment union resolves moderator ownership and preserves absent owner",async(t)=>{
 await seed();await driver.executeQuery("MATCH (i:Issue),(c:Comment),(m:ModerationProfile),(a:User)-[r:AUTHORED_COMMENT]->(c) DELETE r SET i.relatedCommentId='c' CREATE (m)-[:AUTHORED_COMMENT]->(c)");
 await snapshotAll(t);const target=await resolveTarget();assert.equal(target.modProfileName,"Moderator");assert.equal(target.username,"alice");
 await driver.executeQuery("MATCH ()-[r:MODERATION_PROFILE]->() DELETE r");assert.equal((await resolveTarget()).username,undefined);
});
test("sequential legacy content and optional revision/wiki fallbacks retain null overwrites",async()=>{
 await seed();await driver.executeQuery("MATCH (i:Issue) SET i.relatedEventId='e',i.relatedCommentId='c',i.relatedWikiRevisionId='r',i.relatedWikiPageId='w'");
 assert.equal((await resolveTarget()).username,"alice");assert.equal((await resolveTarget({includeTextVersion:true,includeWikiPage:true})).username,"bob");
 await driver.executeQuery("MATCH (u:User)-[r:AUTHORED_VERSION]->(:TextVersion) DELETE r");assert.equal((await resolveTarget({includeTextVersion:true,includeWikiPage:true})).username,"alice");
 await driver.executeQuery("MATCH (u:User)-[r:AUTHORED_WIKI_PAGE]->(:WikiPage) DELETE r");assert.equal((await resolveTarget({includeTextVersion:true,includeWikiPage:true})).username,"bob");
 await assert.rejects(resolveTarget({includeTextVersion:true}),/Could not find/);
});
test("anonymous internal filtering applies to roots and nested issue targets",async(t)=>{
 await seed();await driver.executeQuery("MATCH (d:Discussion) SET d.hasSensitiveContent=true");await snapshotAll(t);assert.deepEqual(await createIssueTargetRepository(driver).findDiscussionAuthor("d"),[]);
 assert.equal((await createIssueTargetRepository(driver).findIssue("i"))[0].TargetDiscussion,null);
 await driver.executeQuery("MATCH (n) WHERE n:Issue OR n:Comment OR n:TextVersion SET n.ageGateRestricted=true");await snapshotAll(t);assert.deepEqual(await createIssueTargetRepository(driver).findIssue("i"),[]);
});
test("invalid arguments and selected scalars retain generated first errors",async(t)=>{
 await seed();const repo=createIssueTargetRepository(driver);
 for(const key of Object.keys(argsByMethod) as Array<keyof IssueTargetRepository>)t.assert.snapshot(await outcome(()=>repo[key](true as never)));
 await driver.executeQuery("MATCH (u:User) SET u.isBot='invalid'");await snapshotAll(t);
 assert.ok((await outcome(()=>repo.findDirectUser("alice"))).error);
});
test("default result limits remain generated defaults for repeated target IDs",async()=>{
 await driver.executeQuery("UNWIND range(1,30) AS n CREATE (:Discussion {id:'d'}) CREATE (:Comment {id:'c'}) CREATE (:TextVersion {id:'r'})");const repo=createIssueTargetRepository(driver);
 assert.equal((await repo.findDiscussionAuthor("d")).length,25);assert.equal((await repo.findCommentAuthor("c")).length,25);assert.equal((await repo.findRevisionAuthor("r")).length,25);
});

test("read snapshots leave the graph unchanged and query callers do not inherit privileged JWT",async(t)=>{
 await seed();
 const snapshot=async()=>plain((await driver.executeQuery("MATCH (n) WITH n ORDER BY elementId(n) RETURN collect({labels:labels(n),props:properties(n)}) AS nodes")).records[0].get("nodes"));
 const before=await snapshot();await snapshotAll(t);await resolveTarget();assert.deepEqual(await snapshot(),before);
 await driver.executeQuery("MATCH (i:Issue) SET i.ageGateRestricted=true");
 const context={driver,mayAccessSensitiveContent:true,jwt:{mayAccessSensitiveContent:true}} as GraphQLContext;
 await assert.rejects(originalPosterSuspended({})(null,{issueId:"i"},context,{} as GraphQLResolveInfo),{message:"Issue not found"});
});
test("actual suspension query consumes target snapshots with unchanged active/expired results",async()=>{
 await seed();const query=originalPosterSuspended({});
 const context={driver,mayAccessSensitiveContent:true} as GraphQLContext;
 const check=async(expected:boolean)=>{
   assert.equal(await query(null,{issueId:"i"},context,{} as GraphQLResolveInfo),expected);
 };
 await check(false);
 await driver.executeQuery("MATCH (ch:Channel {uniqueName:'cats'}),(u:User {username:'alice'}) CREATE (s:Suspension {id:'s',username:'alice',suspendedIndefinitely:true}) CREATE (ch)-[:SUSPENDED_AS_USER]->(s),(u)-[:SUSPENDED_AS_USER]->(s)");await check(true);
 await driver.executeQuery("MATCH (s:Suspension) SET s.suspendedIndefinitely=false,s.suspendedUntil=datetime('2020-01-01T00:00:00Z')");await check(false);
});
