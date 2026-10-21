import {campaignQueryRepositoryStub} from "../../tests/fixtures/campaignQueryRepositoryStub.js";
import {campaignServiceRepositoryStub} from "../../tests/fixtures/campaignServiceRepositoryStub.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMap } from "../../ogm_types.js";
import {
  getPluginPipelineCampaignFailures as actualgetPluginPipelineCampaignFailures,
  getPluginPipelineCampaigns as actualgetPluginPipelineCampaigns,
  previewPluginPipelineCampaign as actualFactory,
} from "./pluginPipelineCampaigns.js";

test("campaign queries expose previews and campaign history", async () => {
  const models = {
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
          applicability: "ALL_FILES_IMMEDIATE",
          steps: [{ pluginId: "scanner" }],
        }],
      }],
    },
    PluginPipelineCampaign: {
      find: async () => [{ id: "campaign-1" }],
    },
  } as unknown as Pick<
    ModelMap,
    "DownloadableFile" | "ServerConfig" | "PluginPipelineCampaign"
  >;

  const preview = await previewPluginPipelineCampaign(models)(
    {},
    { policyId: "policy-1" }
  );
  assert.equal(preview.affectedFileCount, 1);
  assert.match(preview.enforcementBehavior, /held/);
  assert.deepEqual(await getPluginPipelineCampaigns(models)(), [
    { id: "campaign-1" },
  ]);
});

test("failure query returns stable public destinations and skips orphaned files", async () => {
  let fileFindCount = 0;
  const models = {
    PluginPipelineRun: {
      find: async () => [
        {
          pipelineId: "failed-1",
          targetId: "file-1",
          status: "FAILED",
          attemptNumber: 2,
        },
        {
          pipelineId: "orphaned",
          targetId: "file-2",
          status: "TIMED_OUT",
          attemptNumber: 1,
        },
      ],
    },
    DownloadableFile: {
      find: async () => {
        fileFindCount += 1;
        return fileFindCount === 1
          ? [{
              id: "file-1",
              Discussion: {
                id: "discussion-1",
                DiscussionChannels: [
                  { channelUniqueName: "cats", archived: false },
                ],
              },
            }]
          : [{ id: "file-2", Discussion: null }];
      },
    },
  } as unknown as Pick<
    ModelMap,
    "DownloadableFile" | "PluginPipelineRun"
  >;

  const result = await getPluginPipelineCampaignFailures(models)(
    {},
    { campaignId: "campaign-1" }
  );
  assert.deepEqual(result, [{
    pipelineId: "failed-1",
    targetId: "file-1",
    discussionId: "discussion-1",
    channelId: "cats",
    status: "FAILED",
    attemptNumber: 2,
  }]);
});

const previewPluginPipelineCampaign = (models: Parameters<typeof campaignServiceRepositoryStub>[0])=>actualFactory({...models,campaignRepository:campaignServiceRepositoryStub(models)});

const getPluginPipelineCampaigns = (models: Parameters<typeof campaignQueryRepositoryStub>[0])=>actualgetPluginPipelineCampaigns({...models,queryRepository:campaignQueryRepositoryStub(models)});

const getPluginPipelineCampaignFailures = (models: Parameters<typeof campaignQueryRepositoryStub>[0])=>actualgetPluginPipelineCampaignFailures({...models,queryRepository:campaignQueryRepositoryStub(models)});

test('campaign failure destinations remain sequential and stop at a lookup rejection', async()=>{
 const calls:string[]=[];
 const queryRepository={findCampaigns:async()=>[],findFailures:async()=>[{pipelineId:'one',targetId:'first',status:'FAILED',attemptNumber:1},{pipelineId:'two',targetId:'second',status:'FAILED',attemptNumber:1},{pipelineId:'three',targetId:'third',status:'FAILED',attemptNumber:1}],findDestination:async(id:string)=>{calls.push(id);if(id==='second')throw Error('destination unavailable');return [];}};
 await assert.rejects(actualgetPluginPipelineCampaignFailures({queryRepository} as any)({}, {campaignId:'campaign'}),/destination unavailable/);
 assert.deepEqual(calls,['first','second']);
});
test('campaign history propagates repository failure without replacing it',async()=>{
 const error=new Error('history unavailable');
 await assert.rejects(actualgetPluginPipelineCampaigns({queryRepository:{findCampaigns:async()=>{throw error;}}} as any)(),value=>value===error);
});
