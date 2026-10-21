import { createIssueTargetRepository } from "../../services/persistence/issueTargetRepository.js";
import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import { getActiveSuspension } from '../../rules/permission/getActiveSuspension.js'
import { createChannelPermissionRepository } from '../../services/persistence/channelPermissionRepository.js'
import { getActiveServerSuspension } from '../../rules/permission/getActiveServerSuspension.js'
import { resolveIssueTarget } from '../shared/resolveIssueTarget.js'
import { mayAccessSensitiveContent } from '../../services/sensitiveContentAccess.js'
import { isSensitiveContentTarget } from '../../services/sensitiveContentTarget.js'

type Input = {
  agePolicyRepository?: AgePolicyReader
}

export default function getResolver (input: Input) {
  const { agePolicyRepository } = input
  return async (parent: unknown, args: { issueId: string }, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { issueId } = args
    if (!issueId) {
      throw new Error('All arguments (issueId) are required')
    }

    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver: context.driver,
      agePolicyRepository,
    })
    if (!canViewSensitiveContent && await isSensitiveContentTarget(context.driver, { issueId })) {
      return false
    }

    const target = await resolveIssueTarget({
      repository: context.issueTargetRepository ?? createIssueTargetRepository(context.driver),
      issueId,
    })

    const suspensionInfo = target.scope === 'server'
      ? await getActiveServerSuspension({
          context,
          username: target.username,
          modProfileName: target.modProfileName,
        })
      : await getActiveSuspension({
          repository:
            context.channelPermissionRepository ??
            createChannelPermissionRepository(context.driver),
          channelUniqueName: target.channelUniqueName as string,
          username: target.username,
          modProfileName: target.modProfileName,
        })

    return suspensionInfo.isSuspended
  }
}
