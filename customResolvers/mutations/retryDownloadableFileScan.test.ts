import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { createRetryDownloadableFileScanResolver } from "./retryDownloadableFileScan.js";

const baseInput = (file: unknown) => ({
  Channel: {},
  Discussion: {},
  DownloadableFile: { find: async () => file ? [file] : [] },
  Plugin: {},
  PluginVersion: {},
  PluginPipelineRun: { find: async () => [] },
  PluginRun: { find: async () => [] },
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

test("routes a modern failed scan through whole-pipeline retry", async () => {
  const input = baseInput({
    uploadedByUsername: "alice",
    scanStatus: "FAILED",
  });
  input.PluginPipelineRun.find = async () => [
    {
      pipelineId: "failed-pipeline",
      createdAt: "2026-07-30T00:00:00.000Z",
    },
  ];
  input.PluginRun.find = async () => [{ id: "new-job" }];
  let sourceId: string | undefined;
  const resolver = createRetryDownloadableFileScanResolver(
    input,
    async () => false,
    (async () => []) as any,
    ((..._factoryArgs: unknown[]) =>
      async (
        _parent: unknown,
        args: { pipelineRunId: string }
      ) => {
        sourceId = args.pipelineRunId;
        return { pipelineId: "new-pipeline" };
      }) as any
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1" },
    contextFor("alice")
  );

  assert.deepEqual(
    { sourceId, result },
    {
      sourceId: "failed-pipeline",
      result: [{ id: "new-job" }],
    }
  );
});
