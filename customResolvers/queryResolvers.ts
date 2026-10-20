import { createAccountRegistrationRepository } from "../services/persistence/accountRegistrationRepository.js";
// Query resolvers. Extracted from customResolvers.ts; receives the shared
// ResolverDeps and wires the custom query resolvers to their models/driver.
import type { ResolverDeps } from "./resolverDeps.js";
import getSiteWideDiscussionList from "./queries/getSiteWideDiscussionList.js";
import getSiteWideWikiList from "./queries/getSiteWideWikiList.js";
import getCommentSection from "./queries/getCommentSection.js";
import getEventComments from "./queries/getEventComments.js";
import getCommentReplies from "./queries/getCommentReplies.js";
import getDiscussionsInChannel from "./queries/getDiscussionsInChannel.js";
import getDiscussionDetail from "./queries/getDiscussionDetail.js";
import { createDiscussionDetailCollectionPageResolver } from "./queries/getDiscussionDetailCollectionPage.js";
import getUserContributions from "./queries/getUserContributions.js";
import getUserWikiEditsCount from "./queries/getUserWikiEditsCount.js";
import getChannelContributions from "./queries/getChannelContributions.js";
import getModContributions from "./queries/getModContributions.js";
import getUserFavoriteComment from "./queries/getUserFavoriteComment.js";
import getSortedChannels from "./queries/getSortedChannels.js";
import isOriginalPosterSuspended from "./queries/isOriginalPosterSuspended.js";
import safetyCheck from "./queries/safetyCheck.js";
import getServerPluginSecrets from "./queries/getServerPluginSecrets.js";
import getInstalledPlugins from "./queries/getInstalledPlugins.js";
import getPluginRunsForDownloadableFile from "./queries/getPluginRunsForDownloadableFile.js";
import getPipelineRuns from "./queries/getPipelineRuns.js";
import publicCollectionsContaining from "./queries/publicCollectionsContaining.js";
import getOwnEmail from "./queries/getOwnEmail.js";
import getAgePolicy from "./queries/getAgePolicy.js";
import getMyAgeProfile from "./queries/getMyAgeProfile.js";
import getDiscussionAgeGateCheck from "./queries/getDiscussionAgeGateCheck.js";
import getServerHealthDashboard from "./queries/getServerHealthDashboard.js";
import getDownloadScanReviewQueue from "./queries/getDownloadScanReviewQueue.js";
import getSiteWideIssueList from "./queries/getSiteWideIssueList.js";
import getUploadedDownloadableFiles from "./queries/getUploadedDownloadableFiles.js";
import getImageAlbumUsage from "./queries/getImageAlbumUsage.js";
import getPluginConfigStatus from './queries/getPluginConfigStatus.js'
import getApplicablePluginPipeline from './queries/getApplicablePluginPipeline.js'
import getPipelineSummary from './queries/getPluginPipelineSummary.js'
import getPublicPipelineRun from './queries/getPublicPluginPipelineRun.js'
import getInternalPluginPipelineRun from './queries/getInternalPluginPipelineRun.js'
import {
  getPluginPipelineCampaigns,
  getPluginPipelineCampaignFailures,
  previewPluginPipelineCampaign,
} from './queries/pluginPipelineCampaigns.js'
import getRankingSettings from "./queries/getRankingSettings.js";
import getChannelDiscussionFlairConfig from "./queries/getChannelDiscussionFlairConfig.js";
import getInstanceSetupStatus from "./queries/getInstanceSetupStatus.js";
import previewPluginConfigurationReconciliation from "./queries/previewPluginConfigurationReconciliation.js";

export default function buildQueryResolvers(deps: ResolverDeps) {
  const {
    ogm,
    instancePolicyRepository,
    driver,
    Discussion,
    DiscussionChannel,
    Event,
    Comment,
    User,
    ModerationProfile,
    Channel,
    Issue,
    Plugin,
    ServerConfig,
    ServerSecret,
    PluginPipelineRun,
    PluginPipelineCampaign,
    PluginRun,
    DownloadableFile,
  } = deps;

  return {
    getSiteWideDiscussionList: getSiteWideDiscussionList({
      Discussion,
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getRankingSettings: getRankingSettings({
      driver,
    }),
    getChannelDiscussionFlairConfig: getChannelDiscussionFlairConfig({
      driver,
    }),
    getInstanceSetupStatus: getInstanceSetupStatus({
      instancePolicyRepository,
    }),
    getSiteWideIssueList: getSiteWideIssueList({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getSiteWideWikiList: getSiteWideWikiList({
      driver,
    }),
    getDiscussionsInChannel: getDiscussionsInChannel({
      driver,
      DiscussionChannel,
      agePolicyRepository: instancePolicyRepository,
    }),
    getDiscussionDetail: getDiscussionDetail({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getDiscussionDetailAnswers: createDiscussionDetailCollectionPageResolver({
      driver,
      agePolicyRepository: instancePolicyRepository,
      kind: "answer",
    }),
    getDiscussionDetailFiles: createDiscussionDetailCollectionPageResolver({
      driver,
      agePolicyRepository: instancePolicyRepository,
      kind: "file",
    }),
    getDiscussionDetailImages: createDiscussionDetailCollectionPageResolver({
      driver,
      agePolicyRepository: instancePolicyRepository,
      kind: "image",
    }),
    getCommentSection: getCommentSection({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getEventComments: getEventComments({
      driver,
    }),
    getCommentReplies: getCommentReplies({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getUserFavoriteComment: getUserFavoriteComment({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getSortedChannels: getSortedChannels({
      driver,
    }),
    getUserContributions: getUserContributions({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getUserWikiEditsCount: getUserWikiEditsCount({
      driver,
    }),
    getChannelContributions: getChannelContributions({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getModContributions: getModContributions({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    isOriginalPosterSuspended: isOriginalPosterSuspended({
      Issue,
      Discussion,
      Event,
      Comment,
      Channel,
      User,
      agePolicyRepository: instancePolicyRepository
    }),
    safetyCheck: safetyCheck,
    getServerPluginSecrets: getServerPluginSecrets({
      driver
    }),
    getPluginConfigStatus: getPluginConfigStatus({ driver }),
    getInstalledPlugins: getInstalledPlugins({
      driver
    }),
    previewPluginConfigurationReconciliation: previewPluginConfigurationReconciliation({
      driver,
    }),
    getPluginRunsForDownloadableFile: getPluginRunsForDownloadableFile({
      PluginRun
    }),
    getPipelineRuns: getPipelineRuns({
      PluginRun
    }),
    getApplicablePluginPipeline: getApplicablePluginPipeline({
      Channel,
      Discussion,
      DownloadableFile,
      ServerConfig,
    }),
    getPipelineSummary: getPipelineSummary({
      Discussion,
      DownloadableFile,
      PluginPipelineRun,
      PluginRun,
    }),
    getPublicPipelineRun: getPublicPipelineRun({
      Discussion,
      DownloadableFile,
      PluginPipelineRun,
      PluginRun,
    }),
    getInternalPluginPipelineRun: getInternalPluginPipelineRun({
      PluginPipelineRun,
      PluginRun,
    }),
    previewPluginPipelineCampaign: previewPluginPipelineCampaign({
      DownloadableFile,
      ServerConfig,
    }),
    getPluginPipelineCampaigns: getPluginPipelineCampaigns({
      PluginPipelineCampaign,
    }),
    getPluginPipelineCampaignFailures: getPluginPipelineCampaignFailures({
      DownloadableFile,
      PluginPipelineRun,
    }),
    publicCollectionsContaining: publicCollectionsContaining({
      driver,
      agePolicyRepository: instancePolicyRepository
    }),
    getOwnEmail: getOwnEmail({
      accountRegistrationRepository: createAccountRegistrationRepository(driver)
    }),
    getAgePolicy: getAgePolicy({ agePolicyRepository: instancePolicyRepository }),
    getMyAgeProfile: getMyAgeProfile({ driver, agePolicyRepository: instancePolicyRepository }),
    getDiscussionAgeGateCheck: getDiscussionAgeGateCheck({ driver, agePolicyRepository: instancePolicyRepository }),
    getUploadedDownloadableFiles: getUploadedDownloadableFiles({
      driver,
      agePolicyRepository: instancePolicyRepository
    }),
    getImageAlbumUsage: getImageAlbumUsage({
      driver,
      agePolicyRepository: instancePolicyRepository
    }),
    getServerHealthDashboard: getServerHealthDashboard({
      driver
    }),
    getDownloadScanReviewQueue: getDownloadScanReviewQueue({ driver, agePolicyRepository: instancePolicyRepository })
  };
}
