// Unit tests for createBotReport — a bot moderator filing/So updating a report
// issue against a comment/discussion/event. Covers the input validation guards
// and the "issue already exists" path (ensure bot user -> look up the reported
// content -> append a moderation action to the existing issue), driven by an
// in-memory OGM. No DB. The new-issue branch (getNextIssueNumber + Issue.create)
// is left to integration.
import assert from "node:assert/strict";
import test from "node:test";
import { createBotReport as actualCreateBotReport } from "./botReportService.js";

// Test-only adapter keeps the original assertions and mock failure behavior.
const createBotReport = (input: any) => actualCreateBotReport({...input,botReportRepository:{
 findExistingReport:(where:any)=>input.models.Issue.find({where}),
 findReportedComment:(id:string)=>input.models.Comment.find({where:{id}}),
 findReportedDiscussion:(id:string)=>input.models.Discussion.find({where:{id}}),
 findReportedEvent:(id:string)=>input.models.Event.find({where:{id}}),
 createReportedIssue:(values:any)=>input.models.Issue.create({input:values}),
 appendBotReport:(where:any,update:any)=>input.models.Issue.update({where,update}),
}});

// Full model set. User/Channel satisfy ensureBotUserForChannel; Issue.find
// returns an existing issue so we take the update path; Comment/Discussion/Event
// return the reported content. `ops` records writes.
function makeModels(opts: {
  existingIssue?: any;
  comment?: any;
  discussion?: any;
  event?: any;
} = {}) {
  const ops: string[] = [];
  const model = (name: string, rows: () => any[]) => ({
    find: async () => rows(),
    create: async () => {
      ops.push(`${name}.create`);
      if (name === "User") return { users: [{ username: "bot-cats-helper" }] };
      return { issues: [{ id: "i-1", issueNumber: 5 }] };
    },
    update: async () => {
      ops.push(`${name}.update`);
      return { issues: [{ id: "i-1", issueNumber: 5 }] };
    },
  });
  const models = {
    User: model("User", () => []), // no existing bot user -> gets created
    Channel: model("Channel", () => [{ uniqueName: "cats", Bots: [] }]),
    Issue: model("Issue", () =>
      opts.existingIssue === null ? [] : [opts.existingIssue ?? { id: "i-1", flaggedServerRuleViolation: false }]
    ),
    Comment: model("Comment", () => (opts.comment ? [opts.comment] : [])),
    Discussion: model("Discussion", () => (opts.discussion ? [opts.discussion] : [])),
    Event: model("Event", () => (opts.event ? [opts.event] : [])),
  } as any;
  return { models, ops };
}

const driver: any = { session: () => ({ run: async () => ({ records: [] }), close: async () => {} }) };

const baseReport = {
  contentType: "comment" as const,
  contentId: "c-1",
  reportText: "spam",
  selectedForumRules: ["No spam"],
  selectedServerRules: [] as string[],
  botName: "helper",
  profileId: null,
  profileLabel: null,
};

test("throws when contentId is missing", async () => {
  const { models } = makeModels();
  await assert.rejects(
    createBotReport({ botIdentityRepository: {findIdentity:async()=>[],createIdentity:async()=>({users:[{username:"bot-cats-helper"}]} as any),reactivateIdentity:async()=>({users:[]} as any),findChannelBots:async()=>[{uniqueName:"cats",Bots:[]}] as any,connectBot:async()=>({channels:[]} as any),disconnectBots:async()=>({channels:[]} as any)}, models, driver, channelUniqueName: "cats", reportInput: { ...baseReport, contentId: "" } }),
    /ID is required/
  );
});

test("throws when the channel name is missing", async () => {
  const { models } = makeModels();
  await assert.rejects(
    createBotReport({ botIdentityRepository: {findIdentity:async()=>[],createIdentity:async()=>({users:[{username:"bot-cats-helper"}]} as any),reactivateIdentity:async()=>({users:[]} as any),findChannelBots:async()=>[{uniqueName:"cats",Bots:[]}] as any,connectBot:async()=>({channels:[]} as any),disconnectBots:async()=>({channels:[]} as any)}, models, driver, channelUniqueName: "", reportInput: baseReport }),
    /Channel unique name is required/
  );
});

test("throws when no rule is selected", async () => {
  const { models } = makeModels();
  await assert.rejects(
    createBotReport({ botIdentityRepository: {findIdentity:async()=>[],createIdentity:async()=>({users:[{username:"bot-cats-helper"}]} as any),reactivateIdentity:async()=>({users:[]} as any),findChannelBots:async()=>[{uniqueName:"cats",Bots:[]}] as any,connectBot:async()=>({channels:[]} as any),disconnectBots:async()=>({channels:[]} as any)},
      models,
      driver,
      channelUniqueName: "cats",
      reportInput: { ...baseReport, selectedForumRules: [], selectedServerRules: [] },
    }),
    /At least one rule must be selected/
  );
});

test("appends a moderation action to an existing issue for a reported comment", async () => {
  const { models, ops } = makeModels({
    comment: { id: "c-1", text: "bad words", CommentAuthor: { __typename: "User", username: "alice" } },
  });
  const result = await createBotReport({ botIdentityRepository: {findIdentity:async()=>[],createIdentity:async()=>({users:[{username:"bot-cats-helper"}]} as any),reactivateIdentity:async()=>({users:[]} as any),findChannelBots:async()=>[{uniqueName:"cats",Bots:[]}] as any,connectBot:async()=>({channels:[]} as any),disconnectBots:async()=>({channels:[]} as any)}, models, driver, channelUniqueName: "cats", reportInput: baseReport });
  assert.equal(result?.issueId, "i-1");
  assert.equal(result?.issueNumber, 5);
  assert.ok(ops.includes("Issue.update"), "updated the existing issue with the report action");
  assert.ok(!ops.includes("Issue.create"), "did not create a new issue");
});

test("resolves the reported author for a discussion report", async () => {
  const { models, ops } = makeModels({
    discussion: { id: "d-1", title: "Bad discussion", Author: { username: "bob" } },
  });
  const result = await createBotReport({ botIdentityRepository: {findIdentity:async()=>[],createIdentity:async()=>({users:[{username:"bot-cats-helper"}]} as any),reactivateIdentity:async()=>({users:[]} as any),findChannelBots:async()=>[{uniqueName:"cats",Bots:[]}] as any,connectBot:async()=>({channels:[]} as any),disconnectBots:async()=>({channels:[]} as any)},
    models,
    driver,
    channelUniqueName: "cats",
    reportInput: { ...baseReport, contentType: "discussion", contentId: "d-1", selectedServerRules: ["Server rule"] },
  });
  assert.equal(result?.issueId, "i-1");
  assert.ok(ops.includes("Issue.update"));
});

test("resolves the reported author for an event report", async () => {
  const { models } = makeModels({
    event: { id: "e-1", title: "Bad event", Poster: { username: "carol" } },
  });
  const result = await createBotReport({ botIdentityRepository: {findIdentity:async()=>[],createIdentity:async()=>({users:[{username:"bot-cats-helper"}]} as any),reactivateIdentity:async()=>({users:[]} as any),findChannelBots:async()=>[{uniqueName:"cats",Bots:[]}] as any,connectBot:async()=>({channels:[]} as any),disconnectBots:async()=>({channels:[]} as any)},
    models,
    driver,
    channelUniqueName: "cats",
    reportInput: { ...baseReport, contentType: "event", contentId: "e-1" },
  });
  assert.equal(result?.issueId, "i-1");
});
