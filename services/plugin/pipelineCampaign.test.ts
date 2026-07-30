import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap, PluginPipelineCampaign } from "../../ogm_types.js";
import {
  PluginPipelineCampaignStatus,
  PluginPipelineRunStatus,
} from "../../ogm_types.js";
import {
  campaignCounts,
  previewPipelineCampaign,
  runPipelineCampaign,
  processRunningPipelineCampaigns,
  PluginPipelineCampaignService,
  type CampaignModels,
} from "./pipelineCampaign.js";
import type { Models } from "./types.js";

type PreviewModels = Pick<ModelMap, "DownloadableFile" | "ServerConfig">;

const previewModels = ({
  files = [
    {
      id: "old-accessible",
      url: "gs://safe/file",
      uploadedAt: "2025-01-01T00:00:00.000Z",
      permanentlyRemoved: false,
    },
    {
      id: "old-missing",
      url: null,
      createdAt: "2025-01-02T00:00:00.000Z",
      permanentlyRemoved: false,
    },
    {
      id: "new-file",
      url: "gs://safe/new",
      uploadedAt: "2026-02-01T00:00:00.000Z",
      permanentlyRemoved: false,
    },
  ],
} = {}) =>
  ({
    DownloadableFile: {
      find: async () => files,
    },
    ServerConfig: {
      find: async () => [{
        pluginPipelines: [{
          policyId: "policy-1",
          event: "downloadableFile.created",
          effectiveAt: "2026-01-01T00:00:00.000Z",
          applicability: "ALL_FILES_GRADUAL",
          steps: [{ pluginId: "scanner" }, { pluginId: "metadata" }],
        }],
      }],
    },
  }) as unknown as PreviewModels;

test("campaign preview reports affected, accessible, and provider counts", async () => {
  const result = await previewPipelineCampaign({
    ...previewModels(),
    policyId: "policy-1",
  });

  assert.equal(result.affectedFileCount, 2);
  assert.equal(result.accessibleFileCount, 1);
  assert.equal(result.unavailableFileCount, 1);
  assert.equal(result.estimatedProviderRuns, 2);
  assert.match(result.enforcementBehavior, /gradually/);
});

test("campaign preview rejects new-files-only policies", async () => {
  const base = previewModels();
  const models = {
    DownloadableFile: base.DownloadableFile,
    ServerConfig: {
      find: async () => [{
        pluginPipelines: [{
          policyId: "policy-1",
          event: "downloadableFile.created",
          effectiveAt: "2026-01-01T00:00:00.000Z",
          applicability: "NEW_FILES_ONLY",
          steps: [{ pluginId: "scanner" }],
        }],
      }],
    },
  } as unknown as PreviewModels;

  await assert.rejects(
    previewPipelineCampaign({ ...models, policyId: "policy-1" }),
    /not eligible/
  );
});

test("campaign counts separate terminal and active outcomes", () => {
  assert.deepEqual(
    campaignCounts([
      { targetId: "1", status: PluginPipelineRunStatus.Succeeded, createdAt: "2026-01-01" },
      { targetId: "2", status: PluginPipelineRunStatus.Running, createdAt: "2026-01-01" },
      { targetId: "3", status: PluginPipelineRunStatus.Failed, createdAt: "2026-01-01" },
      { targetId: "4", status: PluginPipelineRunStatus.TimedOut, createdAt: "2026-01-01" },
    ]),
    {
      completedCount: 1,
      runningCount: 1,
      failedCount: 1,
      timedOutCount: 1,
    }
  );
});

test("campaign runner honors concurrency and records provenance", async () => {
  const base = previewModels({
    files: [
      {
        id: "file-1",
        url: "gs://safe/one",
        uploadedAt: "2025-01-01T00:00:00.000Z",
        permanentlyRemoved: false,
      },
      {
        id: "file-2",
        url: "gs://safe/two",
        uploadedAt: "2025-01-02T00:00:00.000Z",
        permanentlyRemoved: false,
      },
    ],
  });
  let attemptFindCount = 0;
  const updates: unknown[] = [];
  const pipelineModels = {
    ...base,
    PluginPipelineRun: {
      find: async () => {
        attemptFindCount += 1;
        return attemptFindCount === 1
          ? []
          : [{
              targetId: "file-1",
              status: "SUCCEEDED",
              createdAt: "2026-01-01T00:00:00.000Z",
            }];
      },
    },
    PluginPipelineCampaign: {
      update: async (input: unknown) => {
        updates.push(input);
        return { pluginPipelineCampaigns: [] };
      },
    },
  } as unknown as CampaignModels;
  const triggered: Array<{
    fileId: string;
    execution?: Parameters<
      typeof import("./downloadTrigger.js").triggerPluginRunsForDownloadableFile
    >[1];
  }> = [];
  const trigger = async (
    args: Parameters<
      typeof import("./downloadTrigger.js").triggerPluginRunsForDownloadableFile
    >[0],
    options: Parameters<
      typeof import("./downloadTrigger.js").triggerPluginRunsForDownloadableFile
    >[1]
  ) => {
    triggered.push({ fileId: args.downloadableFileId, execution: options });
    return [];
  };
  const campaign = {
    id: "campaign-1",
    policyId: "policy-1",
    status: PluginPipelineCampaignStatus.Running,
    concurrency: 1,
    rateLimitPerMinute: 10,
    createdByUsername: "admin",
  } as PluginPipelineCampaign;

  const result = await runPipelineCampaign({
    models: pipelineModels,
    campaign,
    now: new Date("2026-01-02T00:00:00.000Z"),
    trigger,
  });

  assert.equal(result.startedCount, 1);
  assert.equal(triggered[0]?.fileId, "file-1");
  assert.deepEqual(triggered[0]?.execution?.execution, {
    trigger: "CAMPAIGN",
    initiatedByUsername: "admin",
    policyId: "policy-1",
    campaignId: "campaign-1",
  });
  assert.equal(updates.length, 1);
});

test("campaign runner does not exceed active concurrency", async () => {
  const base = previewModels();
  const updates: unknown[] = [];
  const models = {
    ...base,
    PluginPipelineRun: {
      find: async () => [{
        targetId: "already-running",
        status: PluginPipelineRunStatus.Running,
        createdAt: "2026-01-02T00:00:00.000Z",
      }],
    },
    PluginPipelineCampaign: {
      update: async (input: unknown) => {
        updates.push(input);
        return { pluginPipelineCampaigns: [] };
      },
    },
  } as unknown as CampaignModels;
  let triggered = false;

  const result = await runPipelineCampaign({
    models,
    campaign: {
      id: "campaign-1",
      policyId: "policy-1",
      concurrency: 1,
      rateLimitPerMinute: 10,
      createdByUsername: "admin",
    } as PluginPipelineCampaign,
    now: new Date("2026-01-02T00:00:00.000Z"),
    trigger: async () => {
      triggered = true;
      return [];
    },
  });

  assert.equal(result.startedCount, 0);
  assert.equal(triggered, false);
  assert.equal(updates.length, 1);
});

test("processor completes empty campaigns and the service can start and stop", async () => {
  const base = previewModels({ files: [] });
  const campaign = {
    id: "campaign-1",
    policyId: "policy-1",
    status: PluginPipelineCampaignStatus.Running,
    concurrency: 2,
    rateLimitPerMinute: 30,
    createdByUsername: "admin",
  } as PluginPipelineCampaign;
  const updates: unknown[] = [];
  let campaignFindCount = 0;
  const models = {
    ...base,
    PluginPipelineRun: {
      find: async () => [],
    },
    PluginPipelineCampaign: {
      find: async () => {
        campaignFindCount += 1;
        return campaignFindCount === 1 ? [campaign] : [];
      },
      update: async (input: unknown) => {
        updates.push(input);
        return { pluginPipelineCampaigns: [] };
      },
    },
  } as unknown as CampaignModels;

  assert.equal(
    await processRunningPipelineCampaigns(
      models,
      new Date("2026-01-02T00:00:00.000Z")
    ),
    1
  );
  assert.match(JSON.stringify(updates[0]), /COMPLETED/);

  const service = new PluginPipelineCampaignService(models, 60_000);
  await service.start();
  service.stop();
  assert.equal(campaignFindCount, 2);
});
