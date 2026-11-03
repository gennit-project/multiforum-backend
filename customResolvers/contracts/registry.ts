import { pluginExecutionMutationNames } from "./pluginExecution.js";
import { pluginPolicyQueryNames } from "./pluginPolicies.js";
import { pluginInstallationMutationNames } from "./pluginInstallation.js";
import { pluginSettingsReadNames } from "./pluginSettingsRead.js";
import { pluginCampaignQueryNames } from "./pluginCampaigns.js";
import { pluginCampaignMutationNames } from "./pluginCampaigns.js";
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
  ["Mutation", "pluginExecutionResolvers", "PluginExecutionMutationResolvers", pluginExecutionMutationNames],
] as const;
export { checkedTypeFieldGroups, checkedTypeFieldNames };
export const checkedResolverFields = [
  ...checkedRootGroups.flatMap(([prefix, , , names]) => names.map(name => `${prefix}.${name}`)),
  ...checkedTypeFieldNames,
].sort();
