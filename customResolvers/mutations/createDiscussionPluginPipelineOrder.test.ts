import assert from "node:assert/strict";
import test from "node:test";
import { modelStub } from "../../tests/fixtures/modelStub.js";
import type {
  triggerChannelPluginPipeline,
  triggerPluginRunsForDownloadableFile,
} from "../../services/pluginRunner.js";
import { triggerCreatedDownloadPipelines } from "./createDiscussionWithChannelConnections.js";

test("runs server download security before channel automation", async () => {
  const calls: string[] = [];
  const triggerDownload: typeof triggerPluginRunsForDownloadableFile =
    async () => {
      calls.push("server");
      return [];
    };
  const triggerChannel: typeof triggerChannelPluginPipeline =
    async ({ channelUniqueName }) => {
      calls.push(`channel:${channelUniqueName}`);
      return [];
    };
  const pluginModels = {
    Channel: modelStub<"Channel">(),
    DownloadableFile: modelStub<"DownloadableFile">(),
    PluginPipelineRun: modelStub<"PluginPipelineRun">(),
    PluginRun: modelStub<"PluginRun">(),
    ServerConfig: modelStub<"ServerConfig">(),
    ServerSecret: modelStub<"ServerSecret">(),
  };

  await triggerCreatedDownloadPipelines({
    discussionId: "discussion-1",
    downloadableFileId: "file-1",
    channelConnections: ["cats", "mods"],
    Discussion: modelStub<"Discussion">(),
    pluginModels,
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

  await triggerCreatedDownloadPipelines({
    discussionId: "discussion-1",
    downloadableFileId: "file-1",
    channelConnections: ["cats"],
    Discussion: modelStub<"Discussion">(),
    pluginModels: {
      Channel: modelStub<"Channel">(),
      DownloadableFile: modelStub<"DownloadableFile">(),
      PluginPipelineRun: modelStub<"PluginPipelineRun">(),
      PluginRun: modelStub<"PluginRun">(),
      ServerConfig: modelStub<"ServerConfig">(),
      ServerSecret: modelStub<"ServerSecret">(),
    },
    triggerDownload,
    triggerChannel,
  });

  assert.deepEqual(calls, ["server-failed", "channel"]);
});
