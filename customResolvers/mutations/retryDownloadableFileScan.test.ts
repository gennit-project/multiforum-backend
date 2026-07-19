import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { createRetryDownloadableFileScanResolver } from "./retryDownloadableFileScan.js";

const baseInput = (file: unknown) => ({
  DownloadableFile: { find: async () => file ? [file] : [] },
  Plugin: {},
  PluginVersion: {},
  PluginRun: {},
  ServerConfig: {},
  ServerSecret: {},
}) as any;

const contextFor = (username: string) => ({
  user: { username },
}) as GraphQLContext;

test("lets the uploader retry a held scan", async () => {
  const calls: unknown[] = [];
  const resolver = createRetryDownloadableFileScanResolver(
    baseInput({ uploadedByUsername: "alice", scanStatus: "FAILED" }),
    async () => false,
    (async (args: unknown) => {
      calls.push(args);
      return [{ id: "run-1" }];
    }) as any
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1" },
    contextFor("alice")
  );

  assert.deepEqual({ result, call: calls[0] && {
    downloadableFileId: (calls[0] as any).downloadableFileId,
    event: (calls[0] as any).event,
  } }, {
    result: [{ id: "run-1" }],
    call: {
      downloadableFileId: "file-1",
      event: "downloadableFile.updated",
    },
  });
});

test("lets an authorized moderator retry someone else's scan", async () => {
  let triggered = false;
  const resolver = createRetryDownloadableFileScanResolver(
    baseInput({ uploadedByUsername: "alice", scanStatus: "SUSPICIOUS" }),
    async () => true,
    (async () => {
      triggered = true;
      return [];
    }) as any
  );

  await resolver(null, { downloadableFileId: "file-1" }, contextFor("mod"));

  assert.equal(triggered, true);
});

test("rejects another user without review permission", async () => {
  const resolver = createRetryDownloadableFileScanResolver(
    baseInput({ uploadedByUsername: "alice", scanStatus: "INFECTED" }),
    async () => false
  );

  await assert.rejects(
    resolver(null, { downloadableFileId: "file-1" }, contextFor("bob")),
    /Not authorized/
  );
});

test("does not retry an already clean file", async () => {
  const resolver = createRetryDownloadableFileScanResolver(
    baseInput({ uploadedByUsername: "alice", scanStatus: "CLEAN" })
  );

  await assert.rejects(
    resolver(null, { downloadableFileId: "file-1" }, contextFor("alice")),
    /does not need another scan/
  );
});
