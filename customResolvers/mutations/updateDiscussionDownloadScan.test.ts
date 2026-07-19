import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import getResolver, {
  getConnectedDownloadableFileIds,
} from "./updateDiscussionWithChannelConnections.js";

test("extracts only newly connected downloadable file IDs", () => {
  assert.deepEqual(
    getConnectedDownloadableFileIds({
      DownloadableFiles: [{
        connect: [
          { where: { node: { id: "replacement-1" } } },
          { where: { node: { id: "replacement-2" } } },
        ],
        disconnect: [{ where: { node: { id: "old-file" } } }],
      }],
    } as any),
    ["replacement-1", "replacement-2"]
  );
});

test("triggers the updated pipeline after connecting a replacement", async () => {
  const calls: any[] = [];
  const Discussion = {
    update: async () => ({ discussions: [] }),
    find: async () => [{ id: "discussion-1" }],
  } as any;
  const session = {
    run: async () => ({ records: [] }),
    close: async () => {},
  };
  const input = {
    Discussion,
    DownloadableFile: { name: "DownloadableFile" },
    PluginRun: { name: "PluginRun" },
    ServerConfig: { name: "ServerConfig" },
    ServerSecret: { name: "ServerSecret" },
    driver: { session: () => session },
  } as any;
  const resolver = getResolver(input, (async (args: unknown) => {
    calls.push(args);
    return [];
  }) as any);

  await resolver(
    null,
    {
      where: { id: "discussion-1" },
      discussionUpdateInput: {
        DownloadableFiles: [{
          connect: [{ where: { node: { id: "replacement-1" } } }],
        }],
      },
    } as any,
    {} as GraphQLContext,
    {} as any
  );

  assert.deepEqual(
    calls.map((call) => ({
      downloadableFileId: call.downloadableFileId,
      event: call.event,
      models: call.models,
    })),
    [{
      downloadableFileId: "replacement-1",
      event: "downloadableFile.updated",
      models: {
        DownloadableFile: input.DownloadableFile,
        Plugin: null,
        PluginVersion: null,
        PluginRun: input.PluginRun,
        ServerConfig: input.ServerConfig,
        ServerSecret: input.ServerSecret,
      },
    }]
  );
});

test("does not retrigger scans for unrelated discussion edits", async () => {
  let triggerCount = 0;
  const resolver = getResolver({
    Discussion: {
      update: async () => ({ discussions: [] }),
      find: async () => [{ id: "discussion-1" }],
    },
    DownloadableFile: {},
    PluginRun: {},
    ServerConfig: {},
    ServerSecret: {},
    driver: {
      session: () => ({ run: async () => ({}), close: async () => {} }),
    },
  } as any, (async () => {
    triggerCount += 1;
    return [];
  }) as any);

  await resolver(
    null,
    {
      where: { id: "discussion-1" },
      discussionUpdateInput: { hasDownload: true },
    } as any,
    {} as GraphQLContext,
    {} as any
  );

  assert.equal(triggerCount, 0);
});
