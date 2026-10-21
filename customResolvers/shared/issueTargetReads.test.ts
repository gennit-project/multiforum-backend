import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLResolveInfo } from "graphql";
import { resolveIssueTarget } from "./resolveIssueTarget.js";
import type { IssueTargetRepository, IssueTargetSnapshot } from "../../services/persistence/issueTargetRepository.js";
import suspendUser from "../mutations/suspendUser.js";
import suspendMod from "../mutations/suspendMod.js";
import unsuspendUser from "../mutations/unsuspendUser.js";
import originalPosterSuspended from "../queries/isOriginalPosterSuspended.js";
import type { GraphQLContext } from "../../types/context.js";
const makeRepo = (issue: IssueTargetSnapshot = {id: "i", Channel:{uniqueName:"cats"}}) => {
  const calls: string[] = [];
  const repository: IssueTargetRepository = {
    findIssue: async id => { calls.push(`issue:${id}`); return [issue]; },
    findProfileOwner: async name => { calls.push(`owner:${name}`);return [{username:"owner"}]; },
    findDirectUser: async name => {calls.push(`user:${name}`);return [{username:name,isBot:false}];},
    findDiscussionAuthor: async id => {calls.push(`discussion:${id}`);return [{Author:{username:"discussion"}}];},
    findEventPoster: async id => {calls.push(`event:${id}`);return [{Poster:{username:"event"}}];},
    findCommentAuthor: async id => {calls.push(`comment:${id}`);return [{CommentAuthor:{username:"comment"}}];},
    findRevisionAuthor: async id => {calls.push(`revision:${id}`);return [{Author:{username:"revision"}}];},
    findWikiAuthors: async id => {calls.push(`wiki:${id}`);return [{OriginalAuthor:{username:"original"},VersionAuthor:{username:"version"}}];},
  };
  return {repository,calls};
};
test("channel scalar does not widen server scope and missing IDs cause no reads", async () => {
 const {repository,calls}=makeRepo({channelUniqueName:"cats",relatedDiscussionId:"d"});
 await assert.rejects(resolveIssueTarget({repository,issueId:""}),{message:"Issue ID is required"});assert.deepEqual(calls,[]);
 await assert.rejects(resolveIssueTarget({repository,issueId:"i"}),{message:"Could not find the user account name to be suspended."});assert.deepEqual(calls,["issue:i"]);
 repository.findIssue=async()=>[];await assert.rejects(resolveIssueTarget({repository,issueId:"missing"}),{message:"Issue not found"});
});
test("direct relationship and mod precedence preserve lookup and bot fallback",async()=>{
 const {repository,calls}=makeRepo({TargetModProfile:{displayName:"live-mod"},relatedModProfileName:"old-mod",TargetUser:{username:"live-user",isBot:false},relatedUsername:"old-user"});
 assert.equal((await resolveIssueTarget({repository,issueId:"i"})).modProfileName,"live-mod");
 assert.deepEqual(calls,["issue:i","owner:live-mod"]);calls.length=0;
 repository.findDirectUser=async name=>{calls.push(`user:${name}`);return[{username:name,isBot:true}];};
 const target=await resolveIssueTarget({repository,issueId:"i",suspendedEntityName:"user"});assert.equal(target.username,"live-user");assert.equal(target.isBot,false);assert.deepEqual(calls,["issue:i","user:live-user"]);
 const failure=new Error("user lookup failed");repository.findDirectUser=async()=>{throw failure;};
 await assert.rejects(resolveIssueTarget({repository,issueId:"i",suspendedEntityName:"user"}),error=>error===failure);
});
test("content reads remain sequential and later missing authors overwrite earlier authors",async()=>{
 const issue={Channel:{uniqueName:"cats"},relatedDiscussionId:"old-d",TargetDiscussion:{id:"d"},relatedEventId:"e",relatedCommentId:"c",relatedWikiRevisionId:"r",relatedWikiPageId:"w"};
 const {repository,calls}=makeRepo(issue);
 repository.findRevisionAuthor=async id=>{calls.push(`revision:${id}`);return[];};
 const target=await resolveIssueTarget({repository,issueId:"i",includeTextVersion:true,includeWikiPage:true});assert.equal(target.username,"original");
 assert.deepEqual(calls,["issue:i","discussion:d","event:e","comment:c","revision:r","wiki:w"]);
 calls.length=0;repository.findCommentAuthor=async()=>[];
 await assert.rejects(resolveIssueTarget({repository,issueId:"i"}),/Could not find/);assert.deepEqual(calls,["issue:i","discussion:d","event:e"]);
});
test("failed earlier content lookup prevents all later reads",async()=>{
 const {repository,calls}=makeRepo({Channel:{uniqueName:"cats"},relatedDiscussionId:"d",relatedEventId:"e",relatedCommentId:"c"});const failure=new Error("discussion unavailable");
 repository.findDiscussionAuthor=async()=>{throw failure;};await assert.rejects(resolveIssueTarget({repository,issueId:"i"}),error=>error===failure);assert.deepEqual(calls,["issue:i"]);
});
test("wiki fallback occurs only without an author and first profile owner is retained",async()=>{
 const {repository,calls}=makeRepo({Channel:{uniqueName:"cats"},relatedCommentId:"c",relatedWikiPageId:"w"});
 repository.findCommentAuthor=async()=>[{CommentAuthor:{displayName:"mod"}}];repository.findProfileOwner=async()=>[{username:"first"},{username:"second"}];
 const target=await resolveIssueTarget({repository,issueId:"i",includeWikiPage:true});assert.equal(target.username,"first");assert.equal(target.modProfileName,"mod");assert.deepEqual(calls,["issue:i"]);
 repository.findProfileOwner=async()=>[];assert.equal((await resolveIssueTarget({repository,issueId:"i"})).username,undefined);
});
test("all three caller families retain target errors before authentication or suspension reads",async()=>{
 const failure=new Error("target read failure");const {repository}=makeRepo();repository.findIssue=async()=>{throw failure;};
 const context={driver:{},issueTargetRepository:repository,mayAccessSensitiveContent:true} as unknown as GraphQLContext;
 const writers={Issue:{} as never,Channel:{} as never,ServerConfig:{} as never};
 const resolvers=[suspendUser(writers),unsuspendUser(writers),originalPosterSuspended({})];
 for(const resolver of resolvers)await assert.rejects(resolver(null,{issueId:"i"} as never,context,{} as GraphQLResolveInfo),error=>error===failure);
});
test("only explicitly enabled suspension path can read wiki/revision targets",async()=>{
 const failure=new Error("wiki target reached");const {repository}=makeRepo({Channel:{uniqueName:"cats"},relatedWikiPageId:"w"});repository.findWikiAuthors=async()=>{throw failure;};
 const context={driver:{},issueTargetRepository:repository,mayAccessSensitiveContent:true} as unknown as GraphQLContext;
 const writers={Issue:{} as never,Channel:{} as never,ServerConfig:{} as never};
 await assert.rejects(suspendUser({...writers,includeWikiPage:true,includeTextVersion:true})(null,{issueId:"i"} as never,context,{} as GraphQLResolveInfo),error=>error===failure);
 for(const resolver of [suspendUser(writers),suspendMod(writers),unsuspendUser(writers),originalPosterSuspended({})])await assert.rejects(resolver(null,{issueId:"i"} as never,context,{} as GraphQLResolveInfo),/Could not find the (user|mod) account name/);
});
