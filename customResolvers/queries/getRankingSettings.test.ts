import assert from "node:assert/strict";
import test from "node:test";
import { getRankingSettings } from "./getRankingSettings.js";

test("getRankingSettings returns defaults and audit metadata", async () => {
  let closed = false;
  const driver = {
    session: () => ({
      run: async () => ({
        records: [
          {
            get: (key: string) => {
              if (key === "settingsJson") return null;
              if (key === "updatedAt") return "2026-07-30T12:00:00.000Z";
              if (key === "updatedBy") return "server-admin";
              return null;
            },
          },
        ],
      }),
      close: async () => {
        closed = true;
      },
    }),
  };

  const resolver = getRankingSettings({ driver: driver as never });
  const result = await resolver(null, { serverName: "test-server" });

  assert.deepEqual(result, {
    version: 1,
    discussionHot: {
      ageOffsetMonths: 2,
      gravity: 1.8,
    },
    commentHot: {
      ageOffsetMonths: 2,
      gravity: 1.8,
    },
    updatedAt: "2026-07-30T12:00:00.000Z",
    updatedBy: "server-admin",
  });
  assert.equal(closed, true);
});
