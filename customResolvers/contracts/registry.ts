import { channelRuleGovernanceMutationNames, channelRuleGovernanceQueryNames } from './channelRuleGovernance.js'
import { downloadReadSourceQueryNames } from "./downloadReadSources.js";
import { wikiCountSourceQueryNames } from "./wikiCountSource.js";
import { contributionReadQueryNames } from "./contributionReadSources.js";
import { viewerReadQueryNames } from "./viewerReadSources.js";
import { imageWriteSourceMutationNames } from "./imageWriteSources.js";
import { moderationArchiveMutationNames } from "./moderationArchives.js";
import { moderationSuspensionMutationNames } from "./moderationSuspensions.js";
import { accountWriteSourceQueryNames } from "./accountWriteSources.js";
import { accountWriteSourceMutationNames } from "./accountWriteSources.js";
import { moderationReportMutationNames } from "./moderationReports.js";
import { moderationUndoMutationNames } from "./moderationUndo.js";
import { downloadWriteMutationNames } from "./downloadWrites.js";
import { moderationLockMutationNames } from "./moderationLocks.js";
import { pluginExecutionMutationNames } from "./pluginExecution.js";
import { pluginSummaryMetadataQueryNames } from "./pluginSummaryMetadata.js";
import { downloadActionMutationNames } from "./downloadActions.js";
import { pluginPolicyQueryNames } from "./pluginPolicies.js";
import { pluginInstallationMutationNames } from "./pluginInstallation.js";
import { pluginSettingsReadNames } from "./pluginSettingsRead.js";
import { pluginCampaignMutationNames, pluginCampaignQueryNames } from "./pluginCampaigns.js";
import { accountSafetyMutationNames, accountSafetyQueryNames } from "./accountSafety.js";
import { pluginConfigurationMutationNames, pluginConfigurationQueryNames } from "./pluginConfiguration.js";
import { votingMutationNames } from "./voting.js";
import { subscriptionMutationNames } from "./subscriptions.js";
import { reactionMutationNames } from "./reactions.js";
import { contentMutationNames } from "./content.js";
import { moderationMutationNames } from "./moderation.js";
import { pluginMutationNames, pluginQueryNames } from "./plugins.js";
import { accountScalarMutationNames, accountObjectMutationNames, accountQueryNames, accountCollectionQueryNames } from "./accounts.js";
import { contentScalarQueryNames, contentPageQueryNames } from "./contentQueries.js";
import { checkedTypeFieldGroups, checkedTypeFieldNames } from "./typeFields.js";

// Checked maps identify the actual composition variables, not parallel examples.
export const checkedRootGroups = [
  ["Mutation", "governanceResolvers", "ChannelRuleGovernanceMutationResolvers", channelRuleGovernanceMutationNames],
  ["Query", "governanceResolvers", "ChannelRuleGovernanceQueryResolvers", channelRuleGovernanceQueryNames],
  ["Mutation", "votingResolvers", "VotingMutationResolvers", votingMutationNames],
  ["Mutation", "subscriptionResolvers", "SubscriptionMutationResolvers", subscriptionMutationNames],
  ["Mutation", "reactionResolvers", "ReactionMutationResolvers", reactionMutationNames],
  ["Mutation", "contentResolvers", "ContentMutationResolvers", contentMutationNames],
  ["Mutation", "moderationResolvers", "ModerationMutationResolvers", moderationMutationNames],
  ["Mutation", "pluginResolvers", "PluginMutationResolvers", pluginMutationNames],
  ["Mutation", "accountScalarResolvers", "AccountScalarMutationResolvers", accountScalarMutationNames],
  ["Mutation", "accountObjectResolvers", "AccountObjectMutationResolvers", accountObjectMutationNames],
  ["Query", "pluginResolvers", "PluginQueryResolvers", pluginQueryNames],
  ["Query", "accountResolvers", "AccountQueryResolvers", accountQueryNames],
  ["Query", "collectionResolvers", "AccountCollectionQueryResolvers", accountCollectionQueryNames],
  ["Query", "contentScalarResolvers", "ContentScalarQueryResolvers", contentScalarQueryNames],
  ["Query", "contentPageResolvers", "ContentPageQueryResolvers", contentPageQueryNames],
  ["Mutation", "pluginConfigurationResolvers", "PluginConfigurationMutationResolvers", pluginConfigurationMutationNames],
  ["Query", "pluginConfigurationResolvers", "PluginConfigurationQueryResolvers", pluginConfigurationQueryNames],
  ["Mutation", "accountSafetyResolvers", "AccountSafetyMutationResolvers", accountSafetyMutationNames],
  ["Query", "accountSafetyResolvers", "AccountSafetyQueryResolvers", accountSafetyQueryNames],
  ["Mutation", "pluginCampaignResolvers", "PluginCampaignMutationResolvers", pluginCampaignMutationNames],
  ["Query", "pluginCampaignResolvers", "PluginCampaignQueryResolvers", pluginCampaignQueryNames],
  ["Query", "pluginSettingsReadResolvers", "PluginSettingsReadResolvers", pluginSettingsReadNames],
  ["Mutation", "pluginInstallationResolvers", "PluginInstallationMutationResolvers", pluginInstallationMutationNames],
  ["Query", "pluginPolicyResolvers", "PluginPolicyQueryResolvers", pluginPolicyQueryNames],
  ["Mutation", "downloadActionResolvers", "DownloadActionMutationResolvers", downloadActionMutationNames],
  ["Query", "pluginSummaryMetadataResolvers", "PluginSummaryMetadataQueryResolvers", pluginSummaryMetadataQueryNames],
  ["Mutation", "pluginExecutionResolvers", "PluginExecutionMutationResolvers", pluginExecutionMutationNames],
  ["Mutation", "downloadWriteResolvers", "DownloadWriteMutationResolvers", downloadWriteMutationNames],
  ["Mutation", "moderationLockResolvers", "ModerationLockMutationResolvers", moderationLockMutationNames],
  ["Mutation", "moderationUndoResolvers", "ModerationUndoMutationResolvers", moderationUndoMutationNames],
  ["Mutation", "moderationReportResolvers", "ModerationReportMutationResolvers", moderationReportMutationNames],
  ["Mutation", "accountWriteSourceResolvers", "AccountWriteSourceMutationResolvers", accountWriteSourceMutationNames],
  ["Query", "accountWriteSourceResolvers", "AccountWriteSourceQueryResolvers", accountWriteSourceQueryNames],
  ["Mutation", "moderationSuspensionResolvers", "ModerationSuspensionMutationResolvers", moderationSuspensionMutationNames],
  ["Mutation", "moderationArchiveResolvers", "ModerationArchiveMutationResolvers", moderationArchiveMutationNames],
  ["Mutation", "imageWriteSourceResolvers", "ImageWriteSourceMutationResolvers", imageWriteSourceMutationNames],
  ["Query", "viewerReadResolvers", "ViewerReadQueryResolvers", viewerReadQueryNames],
  ["Query", "contributionReadResolvers", "ContributionReadQueryResolvers", contributionReadQueryNames],
  ["Query", "wikiCountSourceResolvers", "WikiCountSourceQueryResolvers", wikiCountSourceQueryNames],
  ["Query", "downloadReadSourceResolvers", "DownloadReadSourceQueryResolvers", downloadReadSourceQueryNames],
] as const;
export { checkedTypeFieldGroups, checkedTypeFieldNames };
export const checkedResolverFields = [
  ...checkedRootGroups.flatMap(([prefix, , , names]) => names.map(name => `${prefix}.${name}`)),
  ...checkedTypeFieldNames,
].sort();
