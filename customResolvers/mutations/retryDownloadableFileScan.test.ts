import assert from "node:assert/strict";
import test from "node:test";
import { PLUGIN_EVENTS } from "../../services/plugin/constants.js";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  createRetryDownloadableFileScanResolver,
  type RetryDownloadableFileScanInput,
} from "./retryDownloadableFileScan.js";

type TriggerRuns = NonNullable<
  Parameters<typeof createRetryDownloadableFileScanResolver>[2]
>;
type RerunResolverFactory = NonNullable<
  Parameters<typeof createRetryDownloadableFileScanResolver>[3]
>;

const baseInput = ({
  file,
  attempts = [],
  jobs = [],
}: {
  file: unknown;
  attempts?: unknown[];
  jobs?: unknown[];
}): RetryDownloadableFileScanInput => ({
  Channel: modelStub<"Channel">(),
  Discussion: modelStub<"Discussion">(),
  DownloadableFile: modelStub<"DownloadableFile">({
    find: async () => file ? [file] : [],
  }),
  Plugin: modelStub<"Plugin">(),
  PluginVersion: modelStub<"PluginVersion">(),
  PluginPipelineRun: modelStub<"PluginPipelineRun">({
    find: async () => attempts,
  }),
  PluginRun: modelStub<"PluginRun">({
    find: async () => jobs,
  }),
  ServerConfig: modelStub<"ServerConfig">(),
  ServerSecret: modelStub<"ServerSecret">(),
});

const contextFor = (username: string) => ({
  user: { username },
}) as GraphQLContext;

test("lets the uploader retry a held scan", async () => {
  const calls: Parameters<TriggerRuns>[0][] = [];
  const triggerRuns: TriggerRuns = async args => {
    calls.push(args);
    return [{ id: "run-1" }] as Awaited<ReturnType<TriggerRuns>>;
  };
  const resolver = createRetryDownloadableFileScanResolver(
    baseInput({
      file: { uploadedByUsername: "alice", scanStatus: "FAILED" },
    }),
    async () => false,
    triggerRuns
  );

  const result = await resolver(
    null,
    { downloadableFileId: "file-1" },
    contextFor("alice")
  );

  assert.deepEqual({ result, call: calls[0] && {
    downloadableFileId: calls[0].downloadableFileId,
    event: calls[0].event,
  } }, {
    result: [{ id: "run-1" }],
    call: {
      downloadableFileId: "file-1",
      event: PLUGIN_EVENTS.DOWNLOADABLE_FILE_UPDATED,
    },
  });
});

test("lets an authorized moderator retry someone else's scan", async () => {
  let triggered = false;
  const triggerRuns: TriggerRuns = async () => {
    triggered = true;
    return [];
  };
  const resolver = createRetryDownloadableFileScanResolver(
    baseInput({
      file: {
        uploadedByUsername: "alice",
        scanStatus: "SUSPICIOUS",
        Discussion: {
          DiscussionChannels: [
            { channelUniqueName: "cats", archived: false },
          ],
        },
      },
    }),
    async () => true,
    triggerRuns
  );

  await resolver(null, { downloadableFileId: "file-1" }, contextFor("mod"));

  assert.equal(triggered, true);
});

test("rejects another user without review permission", async () => {
  const resolver = createRetryDownloadableFileScanResolver(
    baseInput({
      file: { uploadedByUsername: "alice", scanStatus: "INFECTED" },
    }),
    async () => false
  );

  await assert.rejects(
    resolver(null, { downloadableFileId: "file-1" }, contextFor("bob")),
    /Not authorized/
  );
});

test("does not retry an already clean file", async () => {
  const resolver = createRetryDownloadableFileScanResolver(
    baseInput({
      file: { uploadedByUsername: "alice", scanStatus: "CLEAN" },
    })
  );

  await assert.rejects(
    resolver(null, { downloadableFileId: "file-1" }, contextFor("alice")),
    /does not need another scan/
  );
});

test("routes a modern failed scan through whole-pipeline retry", async () => {
  const input = baseInput({
    file: {
      uploadedByUsername: "alice",
      scanStatus: "FAILED",
    },
    attempts: [
      {
        pipelineId: "failed-pipeline",
        createdAt: "2026-07-30T00:00:00.000Z",
      },
    ],
    jobs: [{ id: "new-job" }],
  });
  let sourceId: string | undefined;
  const triggerRuns: TriggerRuns = async () => [];
  const createRerunResolver: RerunResolverFactory =
    () => async (_parent, args) => {
      sourceId = args.pipelineRunId;
      return {
        pipelineId: "new-pipeline",
      } as Awaited<ReturnType<ReturnType<RerunResolverFactory>>>;
    };
  const resolver = createRetryDownloadableFileScanResolver(
    input,
    async () => false,
    triggerRuns,
    createRerunResolver
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
