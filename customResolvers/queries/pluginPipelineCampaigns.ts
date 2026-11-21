import {campaignSource} from '../contracts/campaignSources.js';
import {rememberCanonicalSource} from '../../services/canonicalSourceFields.js';
import {createCampaignQueryRepository,type CampaignQueryRepository} from "../../services/persistence/campaignQueryRepository.js";
import type {Driver} from "neo4j-driver";
import type {CampaignServiceRepository} from "../../services/persistence/campaignServiceRepository.js";
import { previewPipelineCampaign } from "../../services/plugin/pipelineCampaign.js";

export const previewPluginPipelineCampaign = ({
  driver,
  campaignRepository,
}: {
  driver?: Driver;
  campaignRepository?: CampaignServiceRepository;
}) =>
  async (_parent: unknown, { policyId }: { policyId: string }) =>
    rememberCanonicalSource(await previewPipelineCampaign({ driver, campaignRepository, policyId }));

export const getPluginPipelineCampaigns = ({
  driver,
  queryRepository,
}: {
  driver?: Driver;
  queryRepository?: CampaignQueryRepository;
}) =>
  async () =>
    (await (queryRepository ?? createCampaignQueryRepository(driver!)).findCampaigns()).map(campaignSource);

export const getPluginPipelineCampaignFailures = ({
  driver,
  queryRepository,
}: {
  driver?: Driver;
  queryRepository?: CampaignQueryRepository;
}) =>
  async (_parent: unknown, { campaignId }: { campaignId: string }) => {
    const repository = queryRepository ?? createCampaignQueryRepository(driver!);
    const attempts = await repository.findFailures(campaignId);
    const failures = [];
    for (const attempt of attempts) {
      const files = await repository.findDestination(attempt.targetId);
      const discussion = files[0]?.Discussion;
      const discussionChannel = discussion?.DiscussionChannels?.find(
        item => item.archived !== true
      );
      const channel = discussionChannel?.channelUniqueName;
      if (!discussion?.id || !channel) continue;
      failures.push(rememberCanonicalSource({
        pipelineId: attempt.pipelineId,
        targetId: attempt.targetId,
        discussionId: discussion.id,
        discussionNumber: discussionChannel?.discussionNumber ?? null,
        channelId: channel,
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
      }));
    }
    return failures;
  };
