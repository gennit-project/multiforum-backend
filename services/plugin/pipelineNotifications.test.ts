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
    repository: {
      findAttempt: async () => models.PluginPipelineRun.find({}),
      findTargetFile: async () => models.DownloadableFile.find({}),
      deliver: async input => { userUpdates.push(input); return true; },
    },
    pipelineId: "pipeline-1",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  assert.equal(notified, true);
  assert.equal(userUpdates.length, 1);
  const serialized = JSON.stringify(userUpdates[0]);
  assert.match(serialized, /pipeline-1/);
  assert.match(serialized, /attempt=pipeline-1/);
  assert.match(serialized, /timed out/);
});

test("notifications skip active, previously notified, and model-less attempts", async () => {
  // An active (non-terminal) attempt is skipped. The uploader-model presence
  // guard this test used to cover (`if (!User) return false`) was removed when
  // the OGM model params were dropped, so the skip is now driven purely by the
  // repository-reported attempt status.
  const repository = {
    findAttempt: async () => [{
      targetId: "file-1",
      targetType: "DownloadableFile",
      status: "RUNNING",
      notifiedAt: null,
    }],
  } as unknown as import('../persistence/pipelineNotificationRepository.js').PipelineNotificationRepository;

  assert.equal(
    await notifyUploaderOfPipelineResult({
      repository,
      pipelineId: "pipeline-1",
    }),
    false
  );
});

for (const outcome of ['missing', 'wrong-target', 'running', 'notified', 'no-uploader', 'lost-claim', 'write-failure']) {
  test(`pipeline notification preserves ${outcome} boundary and ordering`, async () => {
    const calls: string[] = [];
    const repository = {
      findAttempt: async () => {calls.push('attempt');return outcome === 'missing' ? [] : [{targetId:'file',targetType:outcome==='wrong-target'?'Comment':'DownloadableFile',status:outcome==='running'?'RUNNING':'FAILED',notifiedAt:outcome==='notified'?'already':null}];},
      findTargetFile: async () => {calls.push('file');return outcome==='no-uploader'?[]:[{uploadedByUsername:'owner'}];},
      deliver: async () => {calls.push('deliver');if(outcome==='write-failure')throw Error('write failed');return false;},
    } as unknown as import('../persistence/pipelineNotificationRepository.js').PipelineNotificationRepository;
    const result = notifyUploaderOfPipelineResult({repository,pipelineId:'p'});
    if(outcome==='write-failure')await assert.rejects(result,/write failed/);else assert.equal(await result,false);
    assert.deepEqual(calls,['missing','wrong-target','running','notified'].includes(outcome)?['attempt']:outcome==='no-uploader'?['attempt','file']:['attempt','file','deliver']);
  });
}
