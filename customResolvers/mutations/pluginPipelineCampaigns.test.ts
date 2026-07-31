import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  createPluginPipelineCampaign,
  pausePluginPipelineCampaign,
  resumePluginPipelineCampaign,
} from "./pluginPipelineCampaigns.js";

type CampaignMutationModels = Pick<
  ModelMap,
  "PluginPipelineCampaign" | "DownloadableFile" | "ServerConfig"
>;

const context = {
  user: { username: "admin" },
} as GraphQLContext;

const makeModels = () => {
  const creates: unknown[] = [];
  const updates: unknown[] = [];
  let status = "RUNNING";
  const models = {
    PluginPipelineCampaign: {
      find: async (input: { where?: { status_IN?: string[] } }) =>
        input.where?.status_IN
          ? []
          : [{ id: "campaign-1", status }],
      create: async (input: unknown) => {
        creates.push(input);
        return {
          pluginPipelineCampaigns: [{ id: "campaign-1", status: "RUNNING" }],
        };
      },
      update: async (input: { update: { status: string } }) => {
        updates.push(input);
        status = input.update.status;
        return {
          pluginPipelineCampaigns: [{ id: "campaign-1", status }],
        };
      },
    },
    DownloadableFile: {
      find: async () => [{
        id: "file-1",
        url: "gs://safe/file",
        uploadedAt: "2025-01-01T00:00:00.000Z",
        permanentlyRemoved: false,
      }],
    },
    ServerConfig: {
      find: async () => [{
        pluginPipelines: [{
          policyId: "policy-1",
          event: "downloadableFile.created",
          effectiveAt: "2026-01-01T00:00:00.000Z",
          applicability: "ALL_FILES_GRADUAL",
          steps: [{ pluginId: "scanner" }],
        }],
      }],
    },
  } as unknown as CampaignMutationModels;
  return { models, creates, updates, setStatus: (value: string) => { status = value; } };
};

test("creates a running campaign from a fresh preview", async () => {
  const { models, creates } = makeModels();
  const resolver = createPluginPipelineCampaign(models);
  const campaign = await resolver(
    {},
    { policyId: "policy-1", concurrency: 2, rateLimitPerMinute: 30 },
    context
  );

  assert.equal(campaign?.id, "campaign-1");
  assert.match(JSON.stringify(creates[0]), /estimatedProviderRuns/);
  assert.match(JSON.stringify(creates[0]), /admin/);
});

test("rejects unsafe campaign limits", async () => {
  const { models } = makeModels();
  await assert.rejects(
    createPluginPipelineCampaign(models)(
      {},
      { policyId: "policy-1", concurrency: 0, rateLimitPerMinute: 30 },
      context
    ),
    /concurrency/
  );
});

test("pauses and resumes only from the matching state", async () => {
  const { models, setStatus } = makeModels();
  const paused = await pausePluginPipelineCampaign(models)(
    {},
    { campaignId: "campaign-1" }
  );
  assert.equal(paused?.status, "PAUSED");

  setStatus("PAUSED");
  const resumed = await resumePluginPipelineCampaign(models)(
    {},
    { campaignId: "campaign-1" }
  );
  assert.equal(resumed?.status, "RUNNING");
});
