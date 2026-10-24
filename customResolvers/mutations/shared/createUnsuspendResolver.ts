import { createSuspensionWriteRepository } from "../../../services/persistence/suspensionWriteRepository.js";
import { createIssueTargetRepository } from "../../../services/persistence/issueTargetRepository.js";
import { GraphQLError } from 'graphql'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../../types/context.js'
import { setUserDataOnContext } from '../../../rules/permission/userDataHelperFunctions.js'
import { formatModerationActionText } from '../../../services/persistence/moderationIssueWrites.js'
import { notifyIssueSubscribers } from '../../../services/issueNotifications.js'
import { resolveIssueTarget } from '../../shared/resolveIssueTarget.js'

type CreateUnsuspendResolverOptions = {

  // The name of the field on the Issue that identifies the user or mod to suspend
  issueRelatedAccountField: 'relatedUsername' | 'relatedModProfileName'

  // The field on Channel to connect the suspended user or mod
  channelSuspendedField: 'SuspendedUsers' | 'SuspendedMods'

  // A short string describing who/what is being suspended
  suspendedEntityName: 'user' | 'mod'

  unsuspendCommentText: string
}

type Args = {
  issueId: string
  explanation: string
}

export function createUnsuspendResolver ({
  suspendedEntityName,
}: CreateUnsuspendResolverOptions) {
  return async function unsuspendEntityResolver (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) {
    const { issueId, explanation } = args
    const actionChannelName = process.env.SERVER_CONFIG_NAME || 'server'

    if (!issueId) {
      throw new GraphQLError('Issue ID is required')
    }

    const { scope, channelUniqueName, relatedAccountName, relatedAccountType } =
      await resolveIssueTarget({
        repository: context.issueTargetRepository ?? createIssueTargetRepository(context.driver),
        issueId,
        suspendedEntityName,
      })

    // 4. Confirm the person calling this is indeed a moderator
    context.user = await setUserDataOnContext({
      context,
    })
    const loggedInUsername = context.user?.username
    if (!loggedInUsername) {
      throw new GraphQLError('User must be logged in')
    }
    const loggedInModName = context.user.data?.ModerationProfile?.displayName
    if (!loggedInModName) {
      throw new GraphQLError(`User ${loggedInUsername} is not a moderator`)
    }

    const repository = context.suspensionWriteRepository ?? createSuspensionWriteRepository(context.driver)
    const actionChannel = channelUniqueName || actionChannelName

    // 5-6. Record the close action then the unsuspend action (same order as before)
    // and close the issue, via the owned moderation write.
    let updatedIssue
    try {
      updatedIssue = await repository.closeSuspensionIssue({
        issueId,
        actions: [
          {
            actionType: 'close',
            actionDescription: 'Closed the issue after unsuspending the user',
            text: null,
            modDisplayName: loggedInModName,
            commentChannelUniqueName: actionChannel,
          },
          {
            actionType: 'unsuspend',
            actionDescription: `Unsuspended ${relatedAccountName}`,
            text: formatModerationActionText({ text: explanation }),
            modDisplayName: loggedInModName,
            commentChannelUniqueName: actionChannel,
          },
        ],
        isOpen: false,
      })
    } catch (err) {
      throw new GraphQLError('Error updating issue')
    }

    const updatedIssueNode = updatedIssue?.issues?.[0] || null
    if (!updatedIssueNode?.id) {
      throw new GraphQLError('Unable to update Issue with ModerationAction')
    }

    await notifyIssueSubscribers({
      notificationSnapshotRepository: context.notificationSnapshotRepository,
      driver: context.driver,
      issueId,
      actorUsername: loggedInUsername,
      actionType: 'unsuspend',
      actionDescription: `Unsuspended ${relatedAccountName}`,
      commentText: explanation
    })

    // 7-8. Remove the owner -> Suspension edge for the matching subject via the
    // owned write (mirrors the former SuspendedUsers/SuspendedMods disconnect).
    if (relatedAccountType === 'User' || relatedAccountType === 'ModerationProfile') {
      try {
        await repository.removeSuspension({
          scope,
          ownerServerName: scope === 'server' ? (process.env.SERVER_CONFIG_NAME ?? null) : null,
          ownerChannelUniqueName: scope === 'server' ? null : channelUniqueName,
          subjectType: relatedAccountType,
          subjectKey: relatedAccountName,
        })
      } catch (err) {
        throw new GraphQLError('Error unsuspending user')
      }
    }

    // 9. Finally, return the updatedIssue’s single Issue node (or null if it’s missing)
    return updatedIssueNode || null
  }
}
