// Integration tests for the directly-callable bot services against live Neo4j:
// botReportService.createBotReport and botUserService.ensureBotUserForChannel /
// createBotComment. (The version-history and comment-notification services are
// subscription-only and not directly invokable, so they're out of scope here.)

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createBotReport } from "../../services/botReportService.js";
import {
  ensureBotUserForChannel,
  createBotComment,
} from "../../services/botUserService.js";
import {
  startImageModEnv,
  stopImageModEnv,
  resetDb,
  run,
  type ImageModEnv,
} from "./imageModerationHarness.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
});

// --- botReportService.createBotReport ---

test("createBotReport ensures a bot, opens an Issue, and records a report action", async () => {
  await run(
    `CREATE (ch:Channel { uniqueName: 'test-channel', displayName: 'Test', createdAt: datetime() })
     CREATE (author:User { username: 'poster' })
     CREATE (c:Comment { id: 'comment-1', text: 'bad comment', isRootComment: true, createdAt: datetime() })
     CREATE (author)-[:AUTHORED_COMMENT]->(c)`
  );

  const result = await createBotReport({
    driver: env.driver,
    channelUniqueName: "test-channel",
    reportInput: {
      contentType: "comment",
      contentId: "comment-1",
      reportText: "This violates the rules",
      selectedForumRules: [],
      selectedServerRules: ["No spam"],
      botName: "modbot",
    },
  });

  assert.ok(result?.issueId, "should return an issue id");

  const issues = await run(
    `MATCH (i:Issue { relatedCommentId: 'comment-1' }) RETURN i.channelUniqueName AS ch, i.isOpen AS isOpen`
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ch, "test-channel");
  assert.equal(issues[0].isOpen, true);

  const bot = await run(`MATCH (u:User { isBot: true }) RETURN count(u) AS n`);
  assert.ok(Number(bot[0].n) >= 1, "a bot user should be created");

  const actions = await run(
    `MATCH (i:Issue { relatedCommentId: 'comment-1' })-[:ACTIVITY_ON_ISSUE]->(a:ModerationAction)
     RETURN collect(a.actionType) AS types`
  );
  assert.ok((actions[0].types as string[]).includes("report"));
});

test("createBotReport throws when no rule is selected", async () => {
  await run(`CREATE (:Channel { uniqueName: 'test-channel', createdAt: datetime() })`);
  await assert.rejects(
    createBotReport({
      driver: env.driver,
      channelUniqueName: "test-channel",
      reportInput: {
        contentType: "comment",
        contentId: "comment-1",
        reportText: "x",
        selectedForumRules: [],
        selectedServerRules: [],
        botName: "modbot",
      },
    }),
    /At least one rule must be selected/i
  );
});

// --- botUserService.ensureBotUserForChannel ---

test("ensureBotUserForChannel creates a bot user with a moderation profile, connected to the channel", async () => {
  await run(`CREATE (:Channel { uniqueName: 'cats', displayName: 'Cats', createdAt: datetime() })`);

  const user = await ensureBotUserForChannel({
    driver: env.driver,
    channelUniqueName: "cats",
    botName: "helper",
  });

  assert.ok(user.username, "should return the bot user");

  const bots = await run(
    `MATCH (ch:Channel { uniqueName: 'cats' })-[:BOT]->(u:User { isBot: true })-[:MODERATION_PROFILE]->(mp:ModerationProfile)
     RETURN u.username AS username, mp.displayName AS modName`
  );
  assert.equal(bots.length, 1, "bot should be connected to the channel with a mod profile");
  assert.equal(bots[0].modName, bots[0].username);
});

test("ensureBotUserForChannel is idempotent (no duplicate bot on repeat)", async () => {
  await run(`CREATE (:Channel { uniqueName: 'cats', displayName: 'Cats', createdAt: datetime() })`);
  const input = {
    driver: env.driver,
    channelUniqueName: "cats",
    botName: "helper",
  };
  await ensureBotUserForChannel(input);
  await ensureBotUserForChannel(input);

  const bots = await run(`MATCH (u:User { isBot: true }) RETURN count(u) AS n`);
  assert.equal(Number(bots[0].n), 1, "repeat call should not create a second bot");
});

test("ensureBotUserForChannel throws when the channel does not exist", async () => {
  await assert.rejects(
    ensureBotUserForChannel({
      driver: env.driver,
      channelUniqueName: "ghost",
      botName: "helper",
    }),
    /not found/i
  );
});

// --- botUserService.createBotComment ---

test("createBotComment creates a comment authored by the bot, in the channel", async () => {
  await run(`CREATE (:Channel { uniqueName: 'cats', displayName: 'Cats', createdAt: datetime() })`);

  const comment = await createBotComment({
    driver: env.driver,
    channelUniqueName: "cats",
    text: "Hello from the bot",
    botName: "helper",
  });

  assert.ok(comment.id, "should return the created comment");

  const rows = await run(
    `MATCH (ch:Channel { uniqueName: 'cats' })-[:HAS_COMMENT]->(c:Comment { text: 'Hello from the bot' })<-[:AUTHORED_COMMENT]-(u:User { isBot: true })
     RETURN c.isRootComment AS isRoot, u.username AS botUsername`
  );
  assert.equal(rows.length, 1, "bot comment should be linked to the channel and the bot author");
  assert.equal(rows[0].isRoot, false);
});

test("createBotComment validates and creates a reply to an existing comment", async () => {
  await run(`
    CREATE (:Channel { uniqueName: 'cats', displayName: 'Cats', createdAt: datetime() })
    CREATE (:Comment { id: 'parent-comment', text: 'Parent', isRootComment: true, createdAt: datetime() })
  `);

  const comment = await createBotComment({
    driver: env.driver,
    channelUniqueName: "cats",
    text: "Bot reply",
    botName: "helper",
    parentCommentId: "parent-comment",
  });

  const rows = await run(
    `MATCH (reply:Comment { id: $replyId })-[:IS_REPLY_TO]->(parent:Comment)
     RETURN parent.id AS parentId`,
    { replyId: comment.id }
  );
  assert.deepEqual(rows, [{ parentId: "parent-comment" }]);
});

test("createBotComment rejects a missing reply parent before creating records", async () => {
  await run(`CREATE (:Channel { uniqueName: 'cats', displayName: 'Cats', createdAt: datetime() })`);

  await assert.rejects(createBotComment({
    driver: env.driver,
    channelUniqueName: "cats",
    text: "Orphaned bot reply",
    botName: "helper",
    parentCommentId: "missing-parent",
  }), /Could not find the comment being replied to/);

  const rows = await run(`
    MATCH (record)
    WHERE record:Comment OR record:User OR record:ModerationProfile
    RETURN count(record) AS count
  `);
  assert.equal(Number(rows[0].count), 0);
});

test("createBotComment throws when text is empty", async () => {
  await run(`CREATE (:Channel { uniqueName: 'cats', createdAt: datetime() })`);
  await assert.rejects(
    createBotComment({
        driver: env.driver,
      channelUniqueName: "cats",
      text: "",
      botName: "helper",
    }),
    /text is required/i
  );
});
