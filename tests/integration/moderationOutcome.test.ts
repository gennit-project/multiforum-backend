import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, type GraphQLSchema } from 'graphql';
import { applyMiddleware } from 'graphql-middleware';
import type { Driver } from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import getResolvers from '../helpers/getTestResolvers.js';
import { registerGeneratedSchema } from '../../services/persistence/generatedSchemaOperations.js';
import { createCommentPluginPipelineMiddleware } from '../../middleware/commentPluginPipelineMiddleware.js';
import discussionPluginPipelineMiddleware from '../../middleware/discussionPluginPipelineMiddleware.js';
import { triggerPluginRunsForComment } from '../../services/plugin/commentTrigger.js';
import { pluginModuleCache } from '../../services/plugin/pluginLoader.js';
import type { BotInvocationContext } from '../../services/plugin/buildBotInvocationContext.js';
import type { ReportContentAsBotInput } from '../../services/botReportService.js';
import { startNeo4j, stopNeo4j, resetDatabase } from './neo4jHarness.js';

const PLUGIN = 'outcome-fixture';
const URL = 'https://fixture.invalid/moderation.tgz';
const CACHE_KEY = `${URL}:index.js`;
const SERVER_RULE = 'No threats\nDo not threaten people.';
const FORUM_RULE = 'Be civil\nDiscuss ideas respectfully.';
const BOT = 'bot-forum-moderator';
const EVENTS = ['comment.created', 'comment.edited', 'discussionChannel.created', 'discussionChannel.edited'];
type Envelope = { type: string; payload: { commentId?: string; discussionId?: string; context: BotInvocationContext } };
type PluginContext = { reportContentAsBot: (input: ReportContentAsBotInput) => Promise<unknown> };
let requests: Envelope[] = [];
let serviceFailure = false;
let serviceGate: Promise<void> = Promise.resolve();
let releaseService = () => {};
let tasks: Promise<unknown>[] = [];

// Deliberately a deterministic plugin/service contract fixture, not a copy of
// the external llm-moderation implementation. The backend supplies the envelope
// and owns execution, leases, reporting, bot identity and all persistence.
async function moderationService(request: Envelope) {
  requests.push(structuredClone(request));
  await serviceGate;
  if (serviceFailure) throw new Error('Fixture moderation service unavailable');
  const text = request.payload.context.comment?.text ?? request.payload.context.discussion?.body ?? '';
  return { violation: text.includes('violation'), reason: 'Fixture rule violation' };
}
class FixtureModerationPlugin {
  private context: PluginContext;
  constructor(...args: unknown[]) { this.context = args[0] as PluginContext; }
  async handleEvent(value: unknown) {
    const envelope = value as Envelope;
    const decision = await moderationService(envelope);
    if (decision.violation) {
      await this.context.reportContentAsBot({
        contentType: envelope.payload.commentId ? 'comment' : 'discussion',
        contentId: envelope.payload.commentId ?? envelope.payload.discussionId!,
        reportText: decision.reason,
        selectedForumRules: envelope.payload.context.channel.rules,
        selectedServerRules: envelope.payload.context.server.rules,
        botName: 'moderator', recommendedAction: 'remove',
        recommendationConfidence: 0.95, recommendationRationale: decision.reason,
      });
    }
    return { success: true, result: { message: 'Fixture moderation completed' } };
  }
}

let driver: Driver;
let writeSchema: GraphQLSchema;
let publicSchema: GraphQLSchema;
before(async () => {
  driver = await startNeo4j();
  const raw = await new Neo4jGraphQL({ driver, typeDefs, resolvers: getResolvers(driver).resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  }).getSchema();
  registerGeneratedSchema(driver, raw);
  // Content creation uses real application resolvers and both production
  // dispatch middleware. Write authorization is covered elsewhere; reads below
  // use the real permissioned public schema, never a permissions mock.
  writeSchema = applyMiddleware(raw, createCommentPluginPipelineMiddleware((args, options) => {
    const task = triggerPluginRunsForComment(args, options);
    tasks.push(task);
    return task;
  }) as never, discussionPluginPipelineMiddleware as never);
  publicSchema = applyMiddleware(raw, permissions);
  pluginModuleCache.set(CACHE_KEY, FixtureModerationPlugin);
}, { timeout: 240_000 });
after(async () => {
  releaseService();
  await Promise.allSettled(tasks);
  pluginModuleCache.delete(CACHE_KEY);
  await stopNeo4j();
});
beforeEach(async () => {
  releaseService();
  await Promise.allSettled(tasks);
  tasks = []; requests = []; serviceFailure = false; serviceGate = Promise.resolve();
  await resetDatabase(driver);
  await driver.executeQuery(`
    CREATE (u:User {username:'author', createdAt:datetime(), isBot:false})
    CREATE (ch:Channel {uniqueName:'forum', displayName:'Forum', createdAt:datetime(), rules:$forumRules})
    CREATE (s:ServerConfig {serverName:'fixture', rules:$serverRules, pluginPipelines:$pipelines})
    CREATE (p:Plugin {id:'plugin', name:$plugin})-[:HAS_VERSION]->(v:PluginVersion {id:'version', version:'1', repoUrl:$url, entryPath:'index.js', manifest:$manifest})
    CREATE (s)-[:INSTALLED {enabled:true}]->(v) CREATE (ch)-[:ENABLED {enabled:true}]->(v)
    CREATE (d:Discussion {id:'seed-discussion', title:'Seed', body:'Ordinary text', createdAt:datetime()})
    CREATE (u)-[:POSTED_DISCUSSION]->(d)
    CREATE (dc:DiscussionChannel {id:'seed-dc', discussionId:'seed-discussion', channelUniqueName:'forum', createdAt:datetime()})
    CREATE (dc)-[:POSTED_IN_CHANNEL]->(d) CREATE (dc)-[:POSTED_IN_CHANNEL]->(ch)
  `, { plugin: PLUGIN, url: URL, manifest: JSON.stringify({ events: EVENTS }),
    serverRules: JSON.stringify([{ summary: ' No threats ', detail: 'Do not threaten people.' }]),
    forumRules: JSON.stringify([{ summary: 'Be civil', detail: ' Discuss ideas respectfully. ' }]),
    pipelines: JSON.stringify(EVENTS.map(event => ({ event, steps: [{ pluginId: PLUGIN, version: '1' }], stopOnFirstFailure: true }))),
  });
});

async function execute(source: string, variables: Record<string, unknown> = {}, publicRead = false, username?: string) {
  return graphql({ schema: publicRead ? publicSchema : writeSchema, source, variableValues: variables,
    contextValue: { driver, req: { headers: {}, body: {}, isMutation: !publicRead },
      ...((username || !publicRead) ? { user: { username: username ?? 'author', email: null, email_verified: true, data: null } } : {}),
    },
  });
}
function ok(result: Awaited<ReturnType<typeof execute>>) {
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  return result.data as Record<string, any>;
}
async function waitForRuns(count: number, status = 'SUCCEEDED') {
  const deadline = Date.now() + 20_000;
  let rows: Array<Record<string, unknown>> = [];
  do {
    rows = (await driver.executeQuery('MATCH (r:PluginRun) RETURN r.status AS status, r.message AS message')).records.map(row => row.toObject());
    if (rows.length === count && rows.every(row => row.status === status)) {
      const attempts = (await driver.executeQuery('MATCH (p:PluginPipelineRun) RETURN p.status AS status')).records;
      if (status === 'RUNNING' || (attempts.length === count && attempts.every(row => row.get('status') === status))) return;
    }
    if (rows.some(row => ['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(String(row.status)))) break;
    await delay(25);
  } while (Date.now() < deadline);
  assert.fail(`Expected ${count} ${status} runs, got ${JSON.stringify(rows)}`);
}
async function createComment(text: string) {
  return ok(await execute(`mutation($input:[OwnedCommentCreateInput!]!){createCommentWithOwnedConnections(input:$input){comments{id text}}}`, {
    input: [{ text, isRootComment: true, CommentAuthor: { User: { connect: { where: { node: { username: 'author' } } } } },
      DiscussionChannel: { connect: { where: { node: { id: 'seed-dc' } } } },
      Channel: { connect: { where: { node: { uniqueName: 'forum' } } } },
    }],
  })).createCommentWithOwnedConnections.comments[0].id as string;
}
const FEED = `query { issues { id isOpen relatedCommentId relatedDiscussionId flaggedServerRuleViolation
  ActivityFeed { actionType recommendedAction recommendationConfidence recommendationRationale
    Comment { text } ModerationProfile { displayName BotUser { username isBot } } } } }`;
function assertRequest(request: Envelope, event: string) {
  assert.equal(request.type, event);
  assert.deepEqual(request.payload.context.server.rules, [SERVER_RULE]);
  assert.deepEqual(request.payload.context.channel.rules, [FORUM_RULE]);
  assert.equal(request.payload.context.channel.pluginEnabled, true);
}
function assertReport(issue: any) {
  assert.equal(issue.isOpen, true);
  assert.equal(issue.flaggedServerRuleViolation, true);
  assert.equal(issue.ActivityFeed.length, 1);
  const action = issue.ActivityFeed[0];
  assert.equal(action.actionType, 'report');
  assert.equal(action.recommendedAction, 'REMOVE');
  assert.equal(action.recommendationConfidence, 0.95);
  assert.equal(action.recommendationRationale, 'Fixture rule violation');
  assert.ok(action.Comment.text.includes(SERVER_RULE));
  assert.ok(action.Comment.text.includes(FORUM_RULE));
  assert.equal(action.ModerationProfile.displayName, BOT);
  assert.equal(action.ModerationProfile.BotUser.username, BOT);
  assert.equal(action.ModerationProfile.BotUser.isBot, true);
}

test('comment creation returns while moderation runs, sends object rules as text and persists a public bot report', async () => {
  serviceGate = new Promise<void>(resolve => { releaseService = resolve; });
  let id: string;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    id = await Promise.race([
      createComment('A violation'),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Content creation blocked on moderation')), 15_000); }),
    ]);
    // Mutation returned while the service is held. No manual startPluginPipeline
    // or direct trigger call is allowed: the middleware must execute the run.
    await waitForRuns(1, 'RUNNING');
    assert.equal((await driver.executeQuery('MATCH (i:Issue) RETURN i')).records.length, 0);
  } finally { clearTimeout(timeout); releaseService(); }
  await Promise.all(tasks);
  await waitForRuns(1);
  assert.equal(requests.length, 1);
  assertRequest(requests[0], 'comment.created');
  assert.equal(requests[0].payload.commentId, id);
  const issues = ok(await execute(FEED, {}, true)).issues;
  assert.equal(issues.length, 1); assert.equal(issues[0].relatedCommentId, id); assertReport(issues[0]);
});

test('comment edits execute; clean content produces no report and service failure is FAILED, never success', async () => {
  const id = await createComment('Ordinary text');
  await Promise.all(tasks); await waitForRuns(1);
  assert.equal(ok(await execute(FEED, {}, true)).issues.length, 0);
  ok(await execute(`mutation($id:ID!){updateComments(where:{id:{eq:$id}},update:{text:{set:"Edited violation"}}){comments{id}}}`, { id }));
  await Promise.all(tasks); await waitForRuns(2);
  assertRequest(requests[1], 'comment.edited');
  assert.equal(requests[1].payload.context.comment?.text, 'Edited violation');
  assertReport(ok(await execute(FEED, {}, true)).issues[0]);
  serviceFailure = true;
  await createComment('Another violation');
  await Promise.all(tasks);
  const runs = (await driver.executeQuery('MATCH (r:PluginRun) RETURN r.status AS status, r.message AS message')).records.map(row => row.toObject());
  assert.equal(runs.filter(row => row.status === 'FAILED').length, 1);
  assert.match(String(runs.find(row => row.status === 'FAILED')?.message), /Fixture moderation service unavailable/);
  const attempts = (await driver.executeQuery('MATCH (p:PluginPipelineRun) RETURN p.status AS status')).records.map(row => row.get('status'));
  assert.deepEqual(attempts.sort(), ['FAILED', 'SUCCEEDED', 'SUCCEEDED']);
  assert.equal(ok(await execute(FEED, {}, true)).issues.length, 1);
});

test('discussion creation and edit execute automatically and persist the reported discussion target', async () => {
  const discussion = ok(await execute(`mutation($input:[DiscussionCreateInputWithChannels!]!){createDiscussionWithChannelConnections(input:$input){id}}`, {
    input: [{ discussionCreateInput: { title: 'Topic', body: 'Ordinary text' }, channelConnections: ['forum'] }],
  })).createDiscussionWithChannelConnections[0];
  await waitForRuns(1); assertRequest(requests[0], 'discussionChannel.created');
  assert.equal(ok(await execute(FEED, {}, true)).issues.length, 0);
  ok(await execute(`mutation($id:ID!){updateDiscussions(where:{id:{eq:$id}},update:{body:{set:"Edited violation"}}){discussions{id}}}`, { id: discussion.id }));
  await waitForRuns(2); assertRequest(requests[1], 'discussionChannel.edited');
  assert.equal(requests[1].payload.context.discussion?.body, 'Edited violation');
  const issues = ok(await execute(FEED, {}, true)).issues;
  assert.equal(issues.length, 1); assert.equal(issues[0].relatedDiscussionId, discussion.id); assertReport(issues[0]);
});

test('disabled server plugin cannot call the service or create reports', async () => {
  await driver.executeQuery('MATCH (:ServerConfig)-[i:INSTALLED]->() SET i.enabled=false');
  await createComment('A violation'); await Promise.all(tasks);
  assert.equal(requests.length, 0);
  assert.equal((await driver.executeQuery('MATCH (r:PluginRun) RETURN r')).records.length, 0);
  assert.equal(ok(await execute(FEED, {}, true)).issues.length, 0);
});

test('public feed traverses bot identity while human moderators and account emails remain private', async () => {
  await createComment('A violation'); await Promise.all(tasks); await waitForRuns(1);
  await driver.executeQuery(`
    CREATE (human:User {username:'private-human', isBot:false})-[:MODERATION_PROFILE]->(mp:ModerationProfile {displayName:'HumanMod', createdAt:datetime()})
    CREATE (legacy:User {username:'bot-looking-human'})-[:MODERATION_PROFILE]->(legacyMp:ModerationProfile {displayName:'LegacyMod', createdAt:datetime()})
    CREATE (:Email {address:'human-private@example.test'})-[:HAS_EMAIL]->(human)
    WITH mp, legacyMp MATCH (i:Issue), (bot:User {username:$bot})
    CREATE (:Email {address:'bot-private@example.test'})-[:HAS_EMAIL]->(bot)
    CREATE (i)-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction {id:'human-action', actionType:'review', createdAt:datetime()})
    CREATE (mp)-[:PERFORMED_MODERATION_ACTION]->(a)
    CREATE (i)-[:ACTIVITY_ON_ISSUE]->(b:ModerationAction {id:'legacy-action', actionType:'review', createdAt:datetime()})
    CREATE (legacyMp)-[:PERFORMED_MODERATION_ACTION]->(b)
  `, { bot: BOT });
  for (const username of [undefined, 'author', 'private-human']) {
    const feed = ok(await execute(FEED, {}, true, username)).issues[0].ActivityFeed;
    assert.equal(feed.length, 3);
    for (const name of ['HumanMod', 'LegacyMod']) {
      assert.equal(feed.find((action: any) => action.ModerationProfile.displayName === name).ModerationProfile.BotUser, null);
    }
    assert.equal(feed.find((action: any) => action.actionType === 'report').ModerationProfile.BotUser.username, BOT);
    const identities = await execute(`query { moderationProfiles { displayName User { username Email { address } } } }`, {}, true, username);
    assert.ok(identities.errors?.length);
    assert.ok(identities.errors.every(error => /Not Authoris/i.test(error.message)));
    assert.ok((identities.data?.moderationProfiles as Array<{ User: unknown }>).every(profile => profile.User === null));
    const reverse = await execute(`query { users(where:{username:{eq:"private-human"}}) { username ModerationProfile { displayName } } }`, {}, true, username);
    if (username === 'private-human') assert.equal(ok(reverse).users[0].ModerationProfile.displayName, 'HumanMod');
    else {
      assert.ok(reverse.errors?.length);
      assert.equal((reverse.data?.users as any[])[0].ModerationProfile, null);
    }
  }
  const botEmail = await execute(`query { moderationProfiles(where:{displayName:{eq:"${BOT}"}}) { BotUser { username Email { address } } } }`, {}, true);
  assert.ok(botEmail.errors?.length);
  assert.equal((botEmail.data?.moderationProfiles as any[])[0].BotUser.username, BOT);
  assert.equal((botEmail.data?.moderationProfiles as any[])[0].BotUser.Email, null);
});
