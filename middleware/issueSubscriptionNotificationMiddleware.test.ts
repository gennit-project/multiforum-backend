import test from "node:test";
import assert from "node:assert/strict";
import {
  createIssueSubscriptionNotificationMiddleware,
  getCreatedActivityNodes,
} from "./issueSubscriptionNotificationMiddleware.js";

test("getCreatedActivityNodes includes activity feed items from update and create inputs", () => {
  const activityNodes = getCreatedActivityNodes({
    update: {
      ActivityFeed: [
        {
          create: [{ node: { actionType: "comment", actionDescription: "updated" } }],
        },
      ],
    },
    create: {
      ActivityFeed: [
        {
          node: { actionType: "close", actionDescription: "closed" },
        },
      ],
    },
  });

  assert.equal(activityNodes.length, 2);
  assert.deepEqual(
    activityNodes.map((node) => node.actionType),
    ["comment", "close"]
  );
});

test("issue subscription middleware notifies for issue comments created via create.ActivityFeed", async () => {
  const calls: Array<Record<string, any>> = [];
  const middleware = createIssueSubscriptionNotificationMiddleware({
    notifyIssueSubscribers: async (input) => {
      calls.push(input);
      return true;
    },
  });

  const resolve = async () => ({
    issues: [{ id: "issue-1" }],
  });

  await middleware.Mutation.updateIssues(
    resolve,
    null,
    {
      where: { id: "issue-1" },
      create: {
        ActivityFeed: [
          {
            node: {
              actionType: "comment",
              actionDescription: "commented on the issue",
              Comment: {
                create: {
                  node: {
                    text: "Subscriber-facing issue reply",
                  },
                },
              },
            },
          },
        ],
      },
    },
    {
      driver: { session: () => ({}) },
      user: { username: "alice" },
      ogm: { model: () => "IssueModel" },
    },
    {} as any
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].issueId, "issue-1");
  assert.equal(calls[0].actionType, "comment");
  assert.equal(calls[0].commentText, "Subscriber-facing issue reply");
});
