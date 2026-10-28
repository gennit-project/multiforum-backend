import { createSuspensionWriteRepository } from "../../../services/persistence/suspensionWriteRepository.js";
import { createIssueTargetRepository } from "../../../services/persistence/issueTargetRepository.js";
import { GraphQLError } from 'graphql'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../../types/context.js'
import { setUserDataOnContext } from '../../../rules/permission/userDataHelperFunctions.js'
import { formatModerationActionText } from '../../../services/persistence/moderationIssueWrites.js'
import { notifyIssueSubscribers } from '../../../services/issueNotifications.js'
import { resolveIssueTarget } from '../../shared/resolveIssueTarget.js'

type CreateSuspensionResolverOptions = {
  includeWikiPage?: boolean
  includeTextVersion?: boolean

  // The name of the field on the Issue that identifies the user or mod to suspend
  issueRelatedAccountField: 'relatedUsername' | 'relatedModProfileName'

  // The field on Channel to connect the suspended user or mod
  channelSuspendedField: 'SuspendedUsers' | 'SuspendedMods'

  // A short string describing who/what is being suspended
  suspendedEntityName: 'user' | 'mod'
  suspensionCommentText: string
}

type Args = {
  issueId: string
  suspendUntil: string
  suspendIndefinitely: boolean
  explanation: string
}

export function createSuspensionResolver ({
  suspendedEntityName,
  includeWikiPage = false,
  includeTextVersion = false,
}: CreateSuspensionResolverOptions) {
  return async function suspendEntityResolver (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) {
    const { issueId, suspendUntil, suspendIndefinitely, explanation } = args
    const actionChannelName = process.env.SERVER_CONFIG_NAME || 'server'

    if (!issueId) {
      throw new GraphQLError('Issue ID is required')
    }

    const {
      scope,
      channelUniqueName,
      relatedAccountName,
      relatedAccountType,
      username,
    } =
      await resolveIssueTarget({
        repository: context.issueTargetRepository ?? createIssueTargetRepository(context.driver),
        includeWikiPage,
        includeTextVersion,
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

    // 5. Create the moderation activity feed item
    const repository = context.suspensionWriteRepository ?? createSuspensionWriteRepository(context.driver)
    const actionChannel = channelUniqueName || actionChannelName

    // 6. Record the suspension action then the close action on the issue via the
    // owned moderation write (two appends, both closing the issue).
    let updatedIssue
    try {
      await repository.appendSuspensionActivity({
        issueId,
        actions: [
          {
            actionType: 'suspension',
            actionDescription: `Suspended ${relatedAccountName}`,
            text: formatModerationActionText({ text: explanation, suspendUntil, suspendIndefinitely }),
            modDisplayName: loggedInModName,
            commentChannelUniqueName: actionChannel,
          },
        ],
        isOpen: false,
      })
      updatedIssue = await repository.closeSuspensionIssue({
        issueId,
        actions: [
          {
            actionType: 'close',
            actionDescription: 'Closed the issue while suspending the user',
            text: null,
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
      actionType: 'suspension',
      actionDescription: `Suspended ${relatedAccountName}`,
      commentText: explanation
    })

    // 7-8. Create the Suspension node and wire its edges (owner Channel/ServerConfig,
    // subject User/ModerationProfile, RelatedIssue) via the owned write — v7 removed
    // the nested to-one connects these used.
    if (relatedAccountType === 'User' || relatedAccountType === 'ModerationProfile') {
      try {
        const { ownerKey } = await repository.addSuspension({
          scope,
          ownerServerName: scope === 'server' ? (process.env.SERVER_CONFIG_NAME ?? null) : null,
          ownerChannelUniqueName: scope === 'server' ? null : channelUniqueName,
          subjectType: relatedAccountType,
          subjectKey: relatedAccountName,
          issueId,
          channelUniqueName,
          serverName: scope === 'server' ? actionChannelName : null,
          username: relatedAccountType === 'User' ? relatedAccountName : username,
          modProfileName: relatedAccountType === 'ModerationProfile' ? relatedAccountName : null,
          suspendedUntil: suspendUntil,
          suspendedIndefinitely: suspendIndefinitely,
        })
        if (!ownerKey) {
          throw new GraphQLError(scope === 'server' ? 'Error updating server config' : 'Error updating channel')
        }
      } catch (err) {
        throw new GraphQLError('Error updating channel')
      }
    }

    // 9. Finally, return the updatedIssue’s single Issue node (or null if it’s missing)
    return updatedIssueNode || null
  }
}
