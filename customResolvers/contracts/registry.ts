import { contentPageQueryNames } from "./contentQueries.js";
import { contentScalarQueryNames } from "./contentQueries.js";
import { contentMutationNames } from "./content.js";
import { checkedTypeFieldGroups, checkedTypeFieldNames } from "./typeFields.js";
import { accountCollectionQueryNames } from "./accounts.js";
import { accountQueryNames } from "./accounts.js";
import { accountObjectMutationNames } from "./accounts.js";
import { accountScalarMutationNames } from "./accounts.js";
import { pluginQueryNames } from "./plugins.js";
import { pluginMutationNames } from "./plugins.js";
import { moderationMutationNames } from "./moderation.js";
import { votingMutationNames } from "./voting.js";
import { subscriptionMutationNames } from "./subscriptions.js";
import { reactionMutationNames } from "./reactions.js";

// Checked maps identify the actual composition variables, not parallel examples.
export const checkedRootGroups = [
  ["Mutation", "votingResolvers", "VotingMutationResolvers", votingMutationNames],
  ["Mutation", "subscriptionResolvers", "SubscriptionMutationResolvers", subscriptionMutationNames],
  ["Mutation", "reactionResolvers", "ReactionMutationResolvers", reactionMutationNames],
  ["Mutation", "moderationResolvers", "ModerationMutationResolvers", moderationMutationNames],
  ["Mutation", "pluginResolvers", "PluginMutationResolvers", pluginMutationNames],
  ["Query", "pluginResolvers", "PluginQueryResolvers", pluginQueryNames],
  ["Mutation", "accountScalarResolvers", "AccountScalarMutationResolvers", accountScalarMutationNames],
  ["Mutation", "accountObjectResolvers", "AccountObjectMutationResolvers", accountObjectMutationNames],
  ["Query", "accountResolvers", "AccountQueryResolvers", accountQueryNames],
  ["Query", "collectionResolvers", "AccountCollectionQueryResolvers", accountCollectionQueryNames],
  ["Mutation", "contentResolvers", "ContentMutationResolvers", contentMutationNames],
  ["Query", "contentScalarResolvers", "ContentScalarQueryResolvers", contentScalarQueryNames],
  ["Query", "contentPageResolvers", "ContentPageQueryResolvers", contentPageQueryNames],
] as const;
export { checkedTypeFieldGroups, checkedTypeFieldNames };
export const checkedResolverFields = [
  ...checkedRootGroups.flatMap(([prefix, , , names]) => names.map(name => `${prefix}.${name}`)),
  ...checkedTypeFieldNames,
].sort();
