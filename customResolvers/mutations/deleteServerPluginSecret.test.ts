import assert from "node:assert/strict";
import test from "node:test";
import type { ServerSecretModel } from "../../ogm_types.js";
import getResolver from "./deleteServerPluginSecret.js";

const makeModel = (overrides: Record<string, unknown> = {}) =>
  ({
    find: async () => [{ id: "secret-1" }],
    delete: async () => ({ nodesDeleted: 1, relationshipsDeleted: 0 }),
    ...overrides,
  }) as unknown as ServerSecretModel;

test("deletes the matching plugin secret", async () => {
  const calls: unknown[] = [];
  const resolver = getResolver({
    ServerSecret: makeModel({
      delete: async (input: unknown) => {
        calls.push(input);
        return { nodesDeleted: 1, relationshipsDeleted: 0 };
      },
    }),
  });

  const result = await resolver(
    undefined,
    { pluginId: "scanner", key: "API_TOKEN" },
    {} as never,
    {} as never,
  );

  assert.equal(result, true);
  assert.deepEqual(calls, [{ where: { id: "secret-1" } }]);
});

test("returns false when no matching secret exists", async () => {
  let deleteCalled = false;
  const resolver = getResolver({
    ServerSecret: makeModel({
      find: async () => [],
      delete: async () => {
        deleteCalled = true;
      },
    }),
  });

  const result = await resolver(
    undefined,
    { pluginId: "scanner", key: "MISSING" },
    {} as never,
    {} as never,
  );

  assert.equal(result, false);
  assert.equal(deleteCalled, false);
});

test("wraps model errors with mutation context", async () => {
  const resolver = getResolver({
    ServerSecret: makeModel({
      find: async () => {
        throw new Error("database unavailable");
      },
    }),
  });

  await assert.rejects(
    resolver(
      undefined,
      { pluginId: "scanner", key: "API_TOKEN" },
      {} as never,
      {} as never,
    ),
    /Failed to delete server plugin secret: database unavailable/,
  );
});
