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
          { where: { node: { id: { eq: "replacement-1" } } } },
          { where: { node: { id: { eq: "replacement-2" } } } },
        ],
        disconnect: [{ where: { node: { id: { eq: "old-file" } } } }],
      }],
    } as any),
    ["replacement-1", "replacement-2"]
  );
});

test("triggers the updated pipeline after connecting a replacement", async () => {
  const calls: any[] = [];
  const discussionUpdateRepository = {
    updateWithinTransaction: async () => {},
    findRevisionSnapshot: async () => [{ id: "discussion-1" }],
    findUpdatedDiscussion: async () => [{ id: "discussion-1" }],
  };
  const session = {
    run: async () => ({ records: [] }),
    executeWrite: async (work: (tx: unknown) => unknown) =>
      work({ run: async () => ({ records: [] }) }),
    close: async () => {},
  };
  const input = {
    discussionUpdateRepository,
    DownloadableFile: { name: "DownloadableFile" },
    PluginPipelineRun: { name: "PluginPipelineRun" },
    PluginRun: { name: "PluginRun" },
    ServerConfig: { name: "ServerConfig" },
    ServerSecret: { name: "ServerSecret" },
    User: { name: "User" },
    driver: { session: () => session },
  } as any;
  const resolver = getResolver(input, (async (args: unknown) => {
    calls.push(args);
    return [];
  }) as any);

  await resolver(
    null,
    {
      where: { id: { eq: "discussion-1" } },
      discussionUpdateInput: {
        DownloadableFiles: [{
          connect: [{ where: { node: { id: { eq: "replacement-1" } } } }],
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
    })),
    [{
      downloadableFileId: "replacement-1",
      event: "downloadableFile.updated",
    }]
  );
});

test("does not retrigger scans for unrelated discussion edits", async () => {
  let triggerCount = 0;
  const resolver = getResolver({
    discussionUpdateRepository: {
      updateWithinTransaction: async () => {},
      findRevisionSnapshot: async () => [{ id: "discussion-1" }],
      findUpdatedDiscussion: async () => [{ id: "discussion-1" }],
    },
    DownloadableFile: {},
    PluginRun: {},
    ServerConfig: {},
    ServerSecret: {},
    driver: {
      session: () => ({
        run: async () => ({}),
        executeWrite: async (work: (tx: unknown) => unknown) =>
          work({ run: async () => ({}) }),
        close: async () => {},
      }),
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
