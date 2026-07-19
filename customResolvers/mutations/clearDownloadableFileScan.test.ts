import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { createClearDownloadableFileScanResolver } from "./clearDownloadableFileScan.js";

test("clears a held scan and notifies the discussion author", async () => {
  const updates: any[] = [];
  const runs: any[] = [];
  let finds = 0;
  const DownloadableFile = {
    find: async () => {
      finds += 1;
      return finds === 1
        ? [{ id: "file-1", scanStatus: "SUSPICIOUS" }]
        : [{ id: "file-1", scanStatus: "CLEAN" }];
    },
    update: async (args: unknown) => {
      updates.push(args);
      return {};
    },
  } as any;
  const driver = {
    session: () => ({
      run: async (...args: unknown[]) => {
        runs.push(args);
        return {};
      },
      close: async () => {},
    }),
  } as any;
  const resolver = createClearDownloadableFileScanResolver({
    DownloadableFile,
    driver,
  });

  const result = await resolver(
    null,
    { downloadableFileId: "file-1", reason: "False positive" },
    {
      user: {
        username: "moderator",
        data: { ModerationProfile: { displayName: "safety-team" } },
      },
    } as GraphQLContext
  );

  assert.deepEqual({
    status: updates[0].update.scanStatus,
    reason: updates[0].update.scanReason,
    notificationParams: runs[0][1],
    result,
  }, {
    status: "CLEAN",
    reason: "Cleared by safety-team: False positive",
    notificationParams: {
      downloadableFileId: "file-1",
      notificationText: "Your downloadable file passed human security review and is now available. Cleared by safety-team: False positive",
    },
    result: { id: "file-1", scanStatus: "CLEAN" },
  });
  assert.deepEqual({
    requestedAt: updates[0].update.reviewRequestedAt,
    requestReason: updates[0].update.reviewRequestReason,
    requestedBy: updates[0].update.reviewRequestedByUsername,
  }, {
    requestedAt: null,
    requestReason: null,
    requestedBy: null,
  });
});

test("rejects a file that is already clean", async () => {
  const resolver = createClearDownloadableFileScanResolver({
    DownloadableFile: {
      find: async () => [{ id: "file-1", scanStatus: "CLEAN" }],
    } as any,
    driver: {} as any,
  });

  await assert.rejects(
    resolver(
      null,
      { downloadableFileId: "file-1" },
      { user: { username: "moderator" } } as GraphQLContext
    ),
    /already clean/
  );
});
