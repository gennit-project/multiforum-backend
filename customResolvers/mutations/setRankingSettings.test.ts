import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { setRankingSettings } from "./setRankingSettings.js";

const buildDriver = ({
  settingsJson,
}: {
  settingsJson?: string | null;
} = {}) => {
  const updateParams: Array<Record<string, unknown>> = [];
  let closed = false;

  const transaction = {
    run: async (query: string, params: Record<string, unknown>) => {
      if (query.includes("RETURN serverConfig.rankingSettingsJson")) {
        return {
          records: [
            {
              get: (key: string) => {
                if (key === "settingsJson") return settingsJson ?? null;
                return null;
              },
            },
          ],
        };
      }

      updateParams.push(params);
      return { records: [] };
    },
  };

  return {
    updateParams,
    wasClosed: () => closed,
    driver: {
      session: () => ({
        executeWrite: async (
          callback: (tx: typeof transaction) => Promise<unknown>
        ) => callback(transaction),
        close: async () => {
          closed = true;
        },
      }),
    },
  };
};

const context = {
  user: {
    username: "server-admin",
  },
} as GraphQLContext;

test("setRankingSettings merges, validates, serializes, and audits a patch", async () => {
  const models = buildDriver();
  const resolver = setRankingSettings({
    driver: models.driver as never,
    now: () => new Date("2026-07-30T12:00:00.000Z"),
  });

  const result = await resolver(
    null,
    {
      serverName: "test-server",
      input: {
        discussionHot: {
          gravity: 2.4,
        },
      },
    },
    context
  );

  assert.deepEqual(result, {
    version: 1,
    discussionHot: {
      ageOffsetMonths: 2,
      gravity: 2.4,
    },
    commentHot: {
      ageOffsetMonths: 2,
      gravity: 1.8,
    },
    updatedAt: "2026-07-30T12:00:00.000Z",
    updatedBy: "server-admin",
  });
  assert.deepEqual(models.updateParams[0], {
    serverName: "test-server",
    settingsJson: JSON.stringify({
      version: 1,
      discussionHot: {
        ageOffsetMonths: 2,
        gravity: 2.4,
      },
      commentHot: {
        ageOffsetMonths: 2,
        gravity: 1.8,
      },
    }),
    updatedAt: "2026-07-30T12:00:00.000Z",
    updatedBy: "server-admin",
  });
  assert.equal(models.wasClosed(), true);
});

test("setRankingSettings rejects empty and invalid patches before writing", async () => {
  const models = buildDriver();
  const resolver = setRankingSettings({
    driver: models.driver as never,
  });

  await assert.rejects(
    () =>
      resolver(
        null,
        {
          serverName: "test-server",
          input: {},
        },
        context
      ),
    /At least one ranking setting/
  );

  await assert.rejects(
    () =>
      resolver(
        null,
        {
          serverName: "test-server",
          input: {
            commentHot: {
              gravity: 0,
            },
          },
        },
        context
      ),
    /gravity must be between/
  );

  assert.equal(models.updateParams.length, 0);
});
