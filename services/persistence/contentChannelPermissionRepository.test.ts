import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  FIND_COMMENT_CHANNELS_QUERY,
  FIND_DISCUSSION_CHANNELS_QUERY,
  FIND_EVENT_CHANNELS_QUERY,
  createContentChannelPermissionRepository,
} from "./contentChannelPermissionRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

test("content channel lookups are parameterized, leader-routed, and normalized", async () => {
  const sessionConfigs: unknown[] = [];
  const calls: Array<{ query: string; parameters: unknown }> = [];
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      sessionConfigs.push(config);
      return {
        async run(query: string, parameters: unknown) {
          calls.push({ query, parameters });
          if (query === FIND_COMMENT_CHANNELS_QUERY) {
            return {
              records: [
                record({
                  found: true,
                  channelUniqueNames: ["cats", "cats", null, ""],
                }),
              ],
            };
          }
          if (query === FIND_DISCUSSION_CHANNELS_QUERY) {
            return {
              records: [
                record({ found: true, channelUniqueNames: ["dogs"] }),
              ],
            };
          }
          return {
            records: [record({ found: false, channelUniqueNames: [] })],
          };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createContentChannelPermissionRepository(
    driver,
    "permission-db"
  );

  assert.deepEqual(await repository.findCommentChannels(["comment-1"]), {
    found: true,
    channelUniqueNames: ["cats"],
  });
  assert.deepEqual(
    await repository.findDiscussionChannels(["discussion-1", "missing"]),
    { found: true, channelUniqueNames: ["dogs"] }
  );
  assert.deepEqual(await repository.findEventChannels(["missing"]), {
    found: false,
    channelUniqueNames: [],
  });

  assert.deepEqual(
    sessionConfigs,
    Array(3).fill({
      database: "permission-db",
      defaultAccessMode: neo4j.session.WRITE,
    })
  );
  assert.deepEqual(calls, [
    {
      query: FIND_COMMENT_CHANNELS_QUERY,
      parameters: { ids: ["comment-1"] },
    },
    {
      query: FIND_DISCUSSION_CHANNELS_QUERY,
      parameters: { ids: ["discussion-1", "missing"] },
    },
    {
      query: FIND_EVENT_CHANNELS_QUERY,
      parameters: { ids: ["missing"] },
    },
  ]);
  assert.equal(closeCalls, 3);
});

test("empty id lists return not found without opening a session", async () => {
  let sessionCalls = 0;
  const driver = {
    session() {
      sessionCalls += 1;
      throw new Error("should not open");
    },
  } as unknown as Driver;
  const repository = createContentChannelPermissionRepository(driver);

  assert.deepEqual(await repository.findCommentChannels([]), {
    found: false,
    channelUniqueNames: [],
  });
  assert.equal(sessionCalls, 0);
});

test("lookups close their session when the query fails", async () => {
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
  const repository = createContentChannelPermissionRepository(driver);

  await assert.rejects(repository.findEventChannels(["event-1"]), /read failed/);
  assert.equal(closeCalls, 1);
});
