import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  FIND_DISCUSSION_CHANNEL_STATE_QUERY,
  FIND_EVENT_CHANNEL_STATE_QUERY,
  FIND_PARENT_COMMENT_STATE_QUERY,
  createCommentCreationAuthorizationRepository,
} from "./commentCreationAuthorizationRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

test("comment creation lookups are parameterized and leader-routed", async () => {
  const sessionConfigs: unknown[] = [];
  const calls: Array<{ query: string; parameters: unknown }> = [];
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      sessionConfigs.push(config);
      return {
        async run(query: string, parameters: unknown) {
          calls.push({ query, parameters });
          if (query === FIND_PARENT_COMMENT_STATE_QUERY) {
            return { records: [record({ archived: true })] };
          }
          if (query === FIND_DISCUSSION_CHANNEL_STATE_QUERY) {
            return {
              records: [
                record({
                  channelUniqueName: "cats",
                  locked: false,
                  archived: null,
                }),
              ],
            };
          }
          return {
            records: [record({ locked: true, archived: false })],
          };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createCommentCreationAuthorizationRepository(
    driver,
    "permission-db"
  );

  assert.deepEqual(await repository.findParentCommentState("comment-1"), {
    found: true,
    archived: true,
  });
  assert.deepEqual(
    await repository.findDiscussionChannelState("discussion-channel-1"),
    {
      found: true,
      channelUniqueName: "cats",
      locked: false,
      archived: null,
    }
  );
  assert.deepEqual(
    await repository.findEventChannelState("event-1", "cats"),
    {
      found: true,
      locked: true,
      archived: false,
    }
  );

  assert.deepEqual(
    sessionConfigs,
    Array(3).fill({
      database: "permission-db",
      defaultAccessMode: neo4j.session.WRITE,
    })
  );
  assert.deepEqual(calls, [
    {
      query: FIND_PARENT_COMMENT_STATE_QUERY,
      parameters: { commentId: "comment-1" },
    },
    {
      query: FIND_DISCUSSION_CHANNEL_STATE_QUERY,
      parameters: { discussionChannelId: "discussion-channel-1" },
    },
    {
      query: FIND_EVENT_CHANNEL_STATE_QUERY,
      parameters: { eventId: "event-1", channelUniqueName: "cats" },
    },
  ]);
  assert.equal(closeCalls, 3);
});

test("comment creation lookups distinguish missing and empty values", async () => {
  const driver = {
    session() {
      return {
        async run(query: string) {
          if (query === FIND_DISCUSSION_CHANNEL_STATE_QUERY) {
            return {
              records: [
                record({
                  channelUniqueName: "",
                  locked: "legacy",
                  archived: undefined,
                }),
              ],
            };
          }
          return { records: [] };
        },
        async close() {},
      };
    },
  } as unknown as Driver;
  const repository = createCommentCreationAuthorizationRepository(driver);

  assert.deepEqual(await repository.findParentCommentState("missing"), {
    found: false,
    archived: null,
  });
  assert.deepEqual(
    await repository.findDiscussionChannelState("discussion-channel-orphan"),
    {
      found: true,
      channelUniqueName: null,
      locked: null,
      archived: null,
    }
  );
  assert.deepEqual(
    await repository.findEventChannelState("missing", "cats"),
    {
      found: false,
      locked: null,
      archived: null,
    }
  );
});

test("comment creation lookups close their session when a query fails", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async run() {
          throw new Error("read failed");
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createCommentCreationAuthorizationRepository(driver);

  await assert.rejects(
    repository.findParentCommentState("comment-1"),
    /read failed/
  );
  assert.equal(closeCalls, 1);
});
