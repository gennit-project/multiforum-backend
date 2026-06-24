import test from "node:test";
import assert from "node:assert/strict";
import {
  createBatchNotifications,
  createNotificationsForUsers,
} from "./commentNotificationHandler.js";

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
            return {
              records: [
                {
                  get(key: string) {
                    if (key === "notificationsCreated") {
                      return { toNumber: () => 1 };
                    }
                    if (key === "notifiedUsers") {
                      return ["alice"];
                    }
                    return undefined;
                  },
                },
              ],
            };
          },
          close() {
            sessionState.closeCalls += 1;
          },
        };
      },
    },
  };
};

test("createBatchNotifications stores notificationType on subscription notifications", async () => {
  const { driver, sessions } = buildDriver();
  const ogm = {
    model() {
      return {
        async find() {
          return [
            {
              id: "discussion-channel-1",
              SubscribedToNotifications: [
                { username: "alice", Email: { address: "alice@example.com" } },
              ],
            },
          ];
        },
      };
    },
  };

  await createBatchNotifications(
    { ogm, driver },
    "alice commented",
    "bob",
    "DiscussionChannel",
    "discussion-channel-1",
    undefined,
    "reply"
  );

  assert.match(sessions[0]?.runCalls[0]?.query, /notificationType: \$notificationType/);
  assert.equal(sessions[0]?.runCalls[0]?.params.notificationType, "reply");
  assert.equal(sessions[0]?.closeCalls, 1);
});

test("createNotificationsForUsers stores notificationType on direct notifications", async () => {
  const { driver, sessions } = buildDriver();

  await createNotificationsForUsers(
    { ogm: { model() {} }, driver },
    [{ username: "alice", email: null }],
    "bob replied",
    undefined,
    "reply"
  );

  assert.match(sessions[0]?.runCalls[0]?.query, /notificationType: \$notificationType/);
  assert.deepEqual(sessions[0]?.runCalls[0]?.params, {
    usernames: ["alice"],
    notificationText: "bob replied",
    notificationType: "reply",
  });
  assert.equal(sessions[0]?.closeCalls, 1);
});
