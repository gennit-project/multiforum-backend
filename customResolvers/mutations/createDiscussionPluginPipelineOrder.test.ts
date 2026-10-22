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
  const driver = {} as Driver;
  const triggerDownload: typeof triggerPluginRunsForDownloadableFile =
    async args => {
      assert.equal(args.driver, driver);
      calls.push("server");
      return [];
    };
  const triggerChannel: typeof triggerChannelPluginPipeline =
    async ({ channelUniqueName, driver: forwardedDriver }) => {
      assert.equal(forwardedDriver, driver);
      calls.push(`channel:${channelUniqueName}`);
      return [];
    };
  await triggerCreatedDiscussionPipelines({
    driver,
    discussionId: "discussion-1",
    downloadableFileId: "file-1",
    channelConnections: ["cats", "mods"],
    triggerDownload,
    triggerChannel,
  });

  assert.deepEqual(calls, ["server", "channel:cats", "channel:mods"]);
});

test("continues channel automation when the server pipeline fails", async () => {
  const calls: string[] = [];
  const triggerDownload: typeof triggerPluginRunsForDownloadableFile =
    async () => {
      calls.push("server-failed");
      throw new Error("scanner unavailable");
    };
  const triggerChannel: typeof triggerChannelPluginPipeline = async () => {
    calls.push("channel");
    return [];
  };

  await triggerCreatedDiscussionPipelines({
    discussionId: "discussion-1",
    downloadableFileId: "file-1",
    channelConnections: ["cats"],
    triggerDownload,
    triggerChannel,
  });

  assert.deepEqual(calls, ["server-failed", "channel"]);
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
