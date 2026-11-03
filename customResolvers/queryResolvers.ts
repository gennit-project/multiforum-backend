import type { PluginPolicyQueryResolvers } from "./contracts/pluginPolicies.js";
import type { PluginSettingsReadResolvers } from "./contracts/pluginSettingsRead.js";
import type { PluginCampaignQueryResolvers } from "./contracts/pluginCampaigns.js";
import type { AccountSafetyQueryResolvers } from "./contracts/accountSafety.js";
import type { PluginConfigurationQueryResolvers } from "./contracts/pluginConfiguration.js";
import type { ContentPageQueryResolvers } from "./contracts/contentQueries.js";
import type { ContentScalarQueryResolvers } from "./contracts/contentQueries.js";
import type { AccountCollectionQueryResolvers } from "./contracts/accounts.js";
import type { AccountQueryResolvers } from "./contracts/accounts.js";
import type { PluginQueryResolvers } from "./contracts/plugins.js";
import { createPipelineSummaryPage, createPipelineRunPage } from './queries/getPluginPipelinePage.js'
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
    instancePolicyRepository,
    driver,
  } = deps;

  const pluginResolvers = {
    getServerPluginSecrets: getServerPluginSecrets({
      driver
    }),
    getPluginRunsForDownloadableFile: getPluginRunsForDownloadableFile({
      driver
    }),
    getPipelineRuns: getPipelineRuns({
      driver
    }),
    getPipelineSummary: getPipelineSummary({
      driver,
    }),
    getPublicPipelineRun: getPublicPipelineRun({
      driver,
    }),
    getInternalPluginPipelineRun: getInternalPluginPipelineRun({
      driver,
    }),
  } satisfies PluginQueryResolvers;

  const accountResolvers = {
    getRankingSettings: getRankingSettings({
      driver,
    }),
    getInstanceSetupStatus: getInstanceSetupStatus({
      instancePolicyRepository,
    }),
    getOwnEmail: getOwnEmail({
      accountRegistrationRepository: createAccountRegistrationRepository(driver)
    }),
    getAgePolicy: getAgePolicy({ agePolicyRepository: instancePolicyRepository }),
  } satisfies AccountQueryResolvers;

  const collectionResolvers = {
    publicCollectionsContaining: publicCollectionsContaining({
      driver,
      agePolicyRepository: instancePolicyRepository
    }),
  } satisfies AccountCollectionQueryResolvers;

  const contentScalarResolvers = {
    getUserFavoriteComment: getUserFavoriteComment({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getUserWikiEditsCount: getUserWikiEditsCount({
      driver,
    }),
    isOriginalPosterSuspended: isOriginalPosterSuspended({
      agePolicyRepository: instancePolicyRepository
    }),
  } satisfies ContentScalarQueryResolvers;

  const contentPageResolvers = {
    getSiteWideDiscussionList: getSiteWideDiscussionList({
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
  } satisfies ContentPageQueryResolvers;

  const pluginConfigurationResolvers = {
    previewPluginConfigurationReconciliation: previewPluginConfigurationReconciliation({
      driver,
    }),
  } satisfies PluginConfigurationQueryResolvers;

  const accountSafetyResolvers = {
    safetyCheck: safetyCheck,
    getMyAgeProfile: getMyAgeProfile({ driver, agePolicyRepository: instancePolicyRepository }),
    getDiscussionAgeGateCheck: getDiscussionAgeGateCheck({ driver, agePolicyRepository: instancePolicyRepository }),
  } satisfies AccountSafetyQueryResolvers;

  const pluginCampaignResolvers = {
    previewPluginPipelineCampaign: previewPluginPipelineCampaign({
      driver,
    }),
    getPluginPipelineCampaigns: getPluginPipelineCampaigns({
      driver,
    }),
    getPluginPipelineCampaignFailures: getPluginPipelineCampaignFailures({
      driver,
    }),
  } satisfies PluginCampaignQueryResolvers;

  const pluginSettingsReadResolvers = {
    getPluginConfigStatus: getPluginConfigStatus({ driver }),
    getInstalledPlugins: getInstalledPlugins({
      driver
    }),
  } satisfies PluginSettingsReadResolvers;

  const pluginPolicyResolvers = {
    getApplicablePluginPipeline: getApplicablePluginPipeline({
      driver,
    }),
  } satisfies PluginPolicyQueryResolvers;

  return {
    ...contentPageResolvers,
    ...accountResolvers,
    getChannelDiscussionFlairConfig: getChannelDiscussionFlairConfig({
      driver,
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
      agePolicyRepository: instancePolicyRepository,
    }),
    getDiscussionDetail: getDiscussionDetail({
      driver,
      agePolicyRepository: instancePolicyRepository,
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
    ...contentScalarResolvers,
    getSortedChannels: getSortedChannels({
      driver,
    }),
    getUserContributions: getUserContributions({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getChannelContributions: getChannelContributions({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    getModContributions: getModContributions({
      driver,
      agePolicyRepository: instancePolicyRepository,
    }),
    ...accountSafetyResolvers,
    ...pluginResolvers,
    ...pluginSettingsReadResolvers,
    ...pluginConfigurationResolvers,
    ...pluginPolicyResolvers,
    getPipelineSummaryPage: createPipelineSummaryPage({ driver }),
    getPipelineRunPage: createPipelineRunPage({ driver }),
    ...pluginCampaignResolvers,
    ...collectionResolvers,
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
