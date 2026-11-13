import type { MutationResolvers, QueryResolvers } from '../../src/generated/graphql.js'
import type { GraphQLContext } from '../../types/context.js'
export const channelRuleGovernanceQueryNames = ['getChannelRuleGovernance','getPluginManagementCapability'] as const
export const channelRuleGovernanceMutationNames = ['approveChannelRuleEnforcement','requestChannelRuleEnforcement','setChannelRuleEnforcement'] as const
export type ChannelRuleGovernanceQueryResolvers = Pick<QueryResolvers<GraphQLContext>,typeof channelRuleGovernanceQueryNames[number]>
export type ChannelRuleGovernanceMutationResolvers = Pick<MutationResolvers<GraphQLContext>,typeof channelRuleGovernanceMutationNames[number]>
