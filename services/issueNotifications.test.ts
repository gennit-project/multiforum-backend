import test from "node:test";
import assert from "node:assert/strict";
import { notifyIssueSubscribers } from "./issueNotifications.js";

const buildDriver = () => {
  const sessions: Array<{ runCalls: any[]; closeCalls: number }> = [];

  return {
    sessions,
    driver: {
      session() {
        const sessionState = {
          runCalls: [] as any[],
          closeCalls: 0,
        };

        sessions.push(sessionState);
        return {
          async run(query: string, params: Record<string, unknown>) {
            sessionState.runCalls.push({ query, params });
            return {};
          },
          async close() {
            sessionState.closeCalls += 1;
          },
        };
      },
    },
  };
};

test("notifyIssueSubscribers notifies subscribers and only emails opted-in users", async () => {
  const { driver, sessions } = buildDriver();
  const sendBatchEmailsCalls: any[] = [];

  const IssueModel = {
    async find() {
      return [
        {
          id: "issue-1",
          issueNumber: 42,
          title: "Broken image links",
          channelUniqueName: "photography",
          SubscribedToNotifications: [
            {
              username: "alice",
              notifyOnSubscribedIssueUpdates: true,
              Email: { address: "alice@example.com" },
            },
            {
              username: "editor",
              notifyOnSubscribedIssueUpdates: true,
              Email: { address: "editor@example.com" },
            },
            {
              username: "bob",
              notifyOnSubscribedIssueUpdates: null,
              Email: { address: "bob@example.com" },
            },
          ],
        },
      ];
    },
  };

  await notifyIssueSubscribers({
    IssueModel,
    driver,
    issueId: "issue-1",
    actorUsername: "editor",
    actionType: "comment",
    actionDescription: "commented on the issue",
    commentText: "I can reproduce this",
    dependencies: {
      async sendBatchEmails(messages) {
        sendBatchEmailsCalls.push(messages);
        return true;
      },
      createIssueSubscriptionNotificationEmail(subject) {
        return {
          subject,
          plainText: "plain body",
          html: "<p>html body</p>",
        };
      },
    },
  });

  assert.deepEqual(sendBatchEmailsCalls, [
    [
      {
        to: "alice@example.com",
        subject: "New reply on Issue #42",
        text: "plain body",
        html: "<p>html body</p>",
      },
      {
        to: "bob@example.com",
        subject: "New reply on Issue #42",
        text: "plain body",
        html: "<p>html body</p>",
      },
    ],
  ]);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0]?.runCalls[0]?.params, {
    usernames: ["alice", "bob"],
    notificationText: "New reply on Issue #42: Broken image links",
  });
});

test("notifyIssueSubscribers skips report actions", async () => {
  const { driver, sessions } = buildDriver();
  const IssueModel = {
    async find() {
      throw new Error("should not query issue for reports");
    },
  };

  const result = await notifyIssueSubscribers({
    IssueModel,
    driver,
    issueId: "issue-1",
    actorUsername: "editor",
    actionType: "report",
    actionDescription: "Reported the issue",
  });

  assert.equal(result, false);
  assert.equal(sessions.length, 0);
});
