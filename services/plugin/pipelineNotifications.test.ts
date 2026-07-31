import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap } from "../../ogm_types.js";
import { notifyUploaderOfPipelineResult } from "./pipelineNotifications.js";

type NotificationModels = Pick<
  ModelMap,
  "DownloadableFile" | "PluginPipelineRun" | "User"
>;

test("terminal download attempts notify the uploader once with a stable link", async () => {
  const userUpdates: unknown[] = [];
  const models = {
    PluginPipelineRun: {
      find: async () => [{
        pipelineId: "pipeline-1",
        targetId: "file-1",
        targetType: "DownloadableFile",
        status: "TIMED_OUT",
        notifiedAt: null,
      }],
      update: async () => ({
        pluginPipelineRuns: [{ pipelineId: "pipeline-1" }],
      }),
    },
    DownloadableFile: {
      find: async () => [{
        id: "file-1",
        uploadedByUsername: "uploader",
        Discussion: {
          id: "discussion-1",
          title: "Safe fixture",
          Author: { username: "owner" },
          DiscussionChannels: [{
            channelUniqueName: "sims4_builds",
            archived: false,
          }],
        },
      }],
    },
    User: {
      update: async (input: unknown) => {
        userUpdates.push(input);
        return { users: [] };
      },
    },
  } as unknown as NotificationModels;

  const notified = await notifyUploaderOfPipelineResult({
    ...models,
    pipelineId: "pipeline-1",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  assert.equal(notified, true);
  assert.equal(userUpdates.length, 1);
  const serialized = JSON.stringify(userUpdates[0]);
  assert.match(serialized, /plugin_pipeline/);
  assert.match(serialized, /attempt=pipeline-1/);
  assert.match(serialized, /timed out/);
});

test("notifications skip active, previously notified, and model-less attempts", async () => {
  const models = {
    PluginPipelineRun: {
      find: async () => [{
        pipelineId: "pipeline-1",
        targetId: "file-1",
        targetType: "DownloadableFile",
        status: "RUNNING",
        notifiedAt: null,
      }],
    },
    DownloadableFile: {},
    User: {},
  } as unknown as NotificationModels;

  assert.equal(
    await notifyUploaderOfPipelineResult({
      DownloadableFile: models.DownloadableFile,
      PluginPipelineRun: models.PluginPipelineRun,
      pipelineId: "pipeline-1",
    }),
    false
  );
  assert.equal(
    await notifyUploaderOfPipelineResult({
      DownloadableFile: models.DownloadableFile,
      PluginPipelineRun: models.PluginPipelineRun,
      pipelineId: "pipeline-1",
      User: undefined,
    }),
    false
  );
});
