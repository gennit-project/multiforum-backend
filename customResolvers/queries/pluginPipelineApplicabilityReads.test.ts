import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { PipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js";
import createResolver from "./getApplicablePluginPipeline.js";

const unexpected = async (): Promise<never> => { throw new Error("unexpected snapshot read"); };
const repository = (overrides: Partial<PipelineTargetRepository>): PipelineTargetRepository => ({
  findDiscussionVisibility: unexpected,
  findDownloadVisibility: unexpected,
  findDownloadTiming: unexpected,
  listServerApplicabilityConfigs: unexpected,
  findChannelApplicabilityConfig: unexpected,
  ...overrides,
});
const create = (snapshots: PipelineTargetRepository) => createResolver({ driver: {} as Driver, pipelineTargetRepository: snapshots });
const visible = { id: "file", Discussion: { id: "discussion", DiscussionChannels: [{ channelUniqueName: "cats", archived: false }] } };

test("invalid applicability scope/context fails before reading persistence", async () => {
  const resolve = create(repository({}));
  for (const args of [
    { downloadableFileId: "file", scope: "INVALID" },
    { downloadableFileId: "file", scope: "CHANNEL" },
  ]) {
    await assert.rejects(resolve(null, args), (error: unknown) => (error as { extensions: { code: string } }).extensions.code === "BAD_USER_INPUT");
  }
});

test("hidden or mismatched public targets stop before timing and configuration reads", async () => {
  for (const file of [undefined, visible]) {
    const resolve = create(repository({ findDownloadVisibility: async () => file ? [file] : [] }));
    await assert.rejects(resolve(null, { downloadableFileId: "file", scope: "CHANNEL", discussionId: "other", channelUniqueName: "cats" }),
      (error: unknown) => (error as { extensions: { code: string } }).extensions.code === "NOT_FOUND");
  }
});

test("channel applicability preserves visibility, timing, server, channel read order", async () => {
  const calls: string[] = [];
  const resolve = create(repository({
    findDownloadVisibility: async (id) => { calls.push(`visible:${id}`); return [visible]; },
    findDownloadTiming: async (id) => { calls.push(`timing:${id}`); return [{ id, createdAt: "2026-01-01" }]; },
    listServerApplicabilityConfigs: async () => { calls.push("server"); return []; },
    findChannelApplicabilityConfig: async (name) => { calls.push(`channel:${name}`); return [{ uniqueName: name }]; },
  }));
  const result = await resolve(null, { downloadableFileId: "file", scope: "CHANNEL", discussionId: "discussion", channelUniqueName: "cats" });
  assert.deepEqual(calls, ["visible:file", "timing:file", "server", "channel:cats"]);
  assert.equal(result.configured, false);
  assert.equal(result.required, false);
  assert.deepEqual(result.expectedJobs, []);
});

test("a missing channel retains NOT_FOUND after server configuration read", async () => {
  const resolve = create(repository({
    findDownloadVisibility: async () => [visible],
    findDownloadTiming: async () => [{ id: "file", createdAt: "2026-01-01" }],
    listServerApplicabilityConfigs: async () => [],
    findChannelApplicabilityConfig: async () => [],
  }));
  await assert.rejects(resolve(null, { downloadableFileId: "file", scope: "CHANNEL", discussionId: "discussion", channelUniqueName: "cats" }),
    (error: unknown) => (error as { extensions: { code: string } }).extensions.code === "NOT_FOUND");
});

test("snapshot errors propagate without being replaced by a permissive default", async () => {
  const error = new Error("snapshot failed");
  const resolve = create(repository({ findDownloadVisibility: async () => { throw error; } }));
  await assert.rejects(resolve(null, { downloadableFileId: "file" }), error);
});
