import type { Driver } from "neo4j-driver";
import assert from "node:assert/strict";
import test from "node:test";
import type {
  triggerChannelPluginPipeline,
  triggerPluginRunsForDownloadableFile,
} from "../../services/pluginRunner.js";
import { triggerCreatedDiscussionPipelines } from "./createDiscussionWithChannelConnections.js";

test("runs server download security before channel automation", async () => {
  const calls: string[] = [];
  const executionModes: unknown[] = [];
  const driver = {} as Driver;
  const triggerDownload: typeof triggerPluginRunsForDownloadableFile =
    async args => {
      assert.equal(args.driver, driver);
      calls.push(`server:${args.downloadableFileId}`);
      return [];
    };
  const triggerChannel: typeof triggerChannelPluginPipeline =
    async ({ channelUniqueName, driver: forwardedDriver }, options) => {
      assert.equal(forwardedDriver, driver);
      calls.push(`channel:${channelUniqueName}`);
      executionModes.push(options?.execution);
      return [];
    };
  await triggerCreatedDiscussionPipelines({
    driver,
    discussionId: "discussion-1",
    downloadableFileIds: ["file-1", "file-2", "file-1"],
    channelConnections: ["cats", "mods"],
    triggerDownload,
    triggerChannel,
  });

  assert.deepEqual(calls, ["server:file-1", "server:file-2", "channel:cats", "channel:mods"]);
  assert.deepEqual(executionModes, [
    { deferExecution: false },
    { deferExecution: false },
  ]);
});

test("continues remaining files and channel automation when a download pipeline fails", async () => {
  const calls: string[] = [];
  const triggerDownload: typeof triggerPluginRunsForDownloadableFile =
    async ({ downloadableFileId }) => {
      calls.push(`server-failed:${downloadableFileId}`);
      throw new Error("scanner unavailable");
    };
  const triggerChannel: typeof triggerChannelPluginPipeline = async () => {
    calls.push("channel");
    return [];
  };

  await triggerCreatedDiscussionPipelines({
    discussionId: "discussion-1",
    downloadableFileIds: ["file-1", "file-2"],
    channelConnections: ["cats"],
    triggerDownload,
    triggerChannel,
  });

  assert.deepEqual(calls, ["server-failed:file-1", "server-failed:file-2", "channel"]);
});

test("runs channel automation for text discussions without invoking a download pipeline", async () => {
  const calls: string[] = [];
  const triggerDownload: typeof triggerPluginRunsForDownloadableFile =
    async () => {
      calls.push("server");
      return [];
    };
  const triggerChannel: typeof triggerChannelPluginPipeline =
    async ({ channelUniqueName, discussionId, event }) => {
      calls.push(`${event}:${discussionId}:${channelUniqueName}`);
      return [];
    };

  await triggerCreatedDiscussionPipelines({
    discussionId: "discussion-1",
    channelConnections: ["cats", "mods"],
    triggerDownload,
    triggerChannel,
  });

  assert.deepEqual(calls, [
    "discussionChannel.created:discussion-1:cats",
    "discussionChannel.created:discussion-1:mods",
  ]);
});
