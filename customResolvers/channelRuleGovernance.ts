import type { Driver } from 'neo4j-driver'
import type { GraphQLContext } from '../types/context.js'
import { createChannelRuleGovernanceRepository, type ChannelRuleGovernanceRepository } from '../services/persistence/channelRuleGovernanceRepository.js'
import { setUserDataOnContext } from '../rules/permission/userDataHelperFunctions.js'
export const channelRuleGovernanceResolvers = (driver: Driver, repository: ChannelRuleGovernanceRepository = createChannelRuleGovernanceRepository(driver)) => ({
  getChannelRuleGovernance: (_: unknown, args: {channelUniqueName:string;pluginId:string}) => repository.status(args.channelUniqueName,args.pluginId),
  setChannelRuleEnforcement: (_: unknown,args:{channelUniqueName:string;pluginId:string;enabled:boolean}) => repository.setEnabled(args.channelUniqueName,args.pluginId,args.enabled),
  requestChannelRuleEnforcement: async (_: unknown,args:{channelUniqueName:string;pluginId:string},context:GraphQLContext) => {
    context.user = await setUserDataOnContext({context})
    if (!context.user?.username) throw new Error('Authentication required.')
    return repository.request(args.channelUniqueName,args.pluginId,context.user.username)
  },
  approveChannelRuleEnforcement: async (_: unknown,args:{issueId:string},context:GraphQLContext) => {
    context.user = await setUserDataOnContext({context})
    if (!context.user?.username) throw new Error('Authentication required.')
    return repository.approve(args.issueId,context.user.username)
  },
})
