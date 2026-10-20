import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  FIND_CHANNEL_CONTENT_FEATURE_POLICY_QUERY,
  FIND_SERVER_FILE_TYPE_POLICY_QUERY,
  createContentFeaturePolicyRepository,
} from "./contentFeaturePolicyRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

test("content feature policy reads are parameterized and leader-routed", async () => {
  const sessionConfigs: unknown[] = [];
  const calls: Array<{ query: string; parameters: unknown }> = [];
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      sessionConfigs.push(config);
      return {
        async run(query: string, parameters: unknown) {
          calls.push({ query, parameters });
          if (query === FIND_CHANNEL_CONTENT_FEATURE_POLICY_QUERY) {
            return {
              records: [
                record({
                  uniqueName: "cats",
                  eventsEnabled: true,
                  feedbackEnabled: false,
                  downloadsEnabled: null,
                  imageUploadsEnabled: true,
                  wikiEnabled: false,
                  allowedFileTypes: ["zip", ".stl"],
                }),
              ],
            };
          }
          return { records: [record({ allowedFileTypes: ["png"] })] };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createContentFeaturePolicyRepository(
    driver,
    "policy-db"
  );

  assert.deepEqual(await repository.findChannelPolicy("cats"), {
    found: true,
    uniqueName: "cats",
    eventsEnabled: true,
    feedbackEnabled: false,
    downloadsEnabled: null,
    imageUploadsEnabled: true,
    wikiEnabled: false,
    allowedFileTypes: ["zip", ".stl"],
  });
  assert.deepEqual(await repository.findServerFileTypePolicy(), {
    found: true,
    allowedFileTypes: ["png"],
  });
  assert.deepEqual(
    sessionConfigs,
    Array(2).fill({
      database: "policy-db",
      defaultAccessMode: neo4j.session.WRITE,
    })
  );
  assert.deepEqual(calls, [
    {
      query: FIND_CHANNEL_CONTENT_FEATURE_POLICY_QUERY,
      parameters: { uniqueName: "cats" },
    },
    { query: FIND_SERVER_FILE_TYPE_POLICY_QUERY, parameters: {} },
  ]);
  assert.equal(closeCalls, 2);
});

test("content feature policies distinguish missing rows and normalize values", async () => {
  let call = 0;
  const driver = {
    session() {
      return {
        async run() {
          call += 1;
          if (call === 1) return { records: [] };
          if (call === 2) {
            return {
              records: [
                record({
                  uniqueName: 42,
                  eventsEnabled: "yes",
                  feedbackEnabled: undefined,
                  downloadsEnabled: false,
                  imageUploadsEnabled: 1,
                  wikiEnabled: true,
                  allowedFileTypes: ["zip", 7, null],
                }),
              ],
            };
          }
          return { records: [record({ allowedFileTypes: "zip" })] };
        },
        async close() {},
      };
    },
  } as unknown as Driver;
  const repository = createContentFeaturePolicyRepository(driver);

  assert.deepEqual(await repository.findChannelPolicy("missing"), {
    found: false,
    uniqueName: null,
    eventsEnabled: null,
    feedbackEnabled: null,
    downloadsEnabled: null,
    imageUploadsEnabled: null,
    wikiEnabled: null,
    allowedFileTypes: [],
  });
  assert.deepEqual(await repository.findChannelPolicy("legacy"), {
    found: true,
    uniqueName: null,
    eventsEnabled: null,
    feedbackEnabled: null,
    downloadsEnabled: false,
    imageUploadsEnabled: null,
    wikiEnabled: true,
    allowedFileTypes: ["zip"],
  });
  assert.deepEqual(await repository.findServerFileTypePolicy(), {
    found: true,
    allowedFileTypes: [],
  });
});

test("content feature policy reads close their session when a query fails", async () => {
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
  const repository = createContentFeaturePolicyRepository(driver);

  await assert.rejects(repository.findChannelPolicy("cats"), /read failed/);
  assert.equal(closeCalls, 1);
});
