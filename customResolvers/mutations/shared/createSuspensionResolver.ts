import { createSuspensionWriteRepository } from "../../../services/persistence/suspensionWriteRepository.js";
import { createIssueTargetRepository } from "../../../services/persistence/issueTargetRepository.js";
import { GraphQLError } from 'graphql'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../../types/context.js'
import type {
  IssueUpdateInput,
  ChannelUpdateInput,
  ServerConfigUpdateInput,
} from '../../../ogm_types.js'
import { setUserDataOnContext } from '../../../rules/permission/userDataHelperFunctions.js'
import { getModerationActionCreateInput } from '../reportComment.js'
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
    const suspensionModActionCreateInput = getModerationActionCreateInput({
      text: explanation,
      loggedInModName,
      channelUniqueName: channelUniqueName || actionChannelName,
      actionType: 'suspension',
      actionDescription: `Suspended ${relatedAccountName}`,
      issueId,
      suspendUntil,
      suspendIndefinitely
    })

    const closeIssueModActionCreateInput = getModerationActionCreateInput({
      loggedInModName,
      channelUniqueName: channelUniqueName || actionChannelName,
      actionType: 'close',
      actionDescription: 'Closed the issue while suspending the user',
      issueId
    })

    const repository = context.suspensionWriteRepository ?? createSuspensionWriteRepository(context.driver)

    // 6. Update the Issue with the ModerationAction
    let updatedIssue
    const closeIssueUpdateInput: IssueUpdateInput = {
      isOpen: false, // Set the issue to closed; suspension is often the final action.
      ActivityFeed: [
        {
          create: [
            { node: closeIssueModActionCreateInput },
          ]
        }
      ]
    }
    const suspendUpdateInput: IssueUpdateInput = {
      isOpen: false, // Set the issue to closed; suspension is often the final action.
      ActivityFeed: [
        {
          create: [
            { node: suspensionModActionCreateInput },
          ]
        }
      ]
    }
    try {
      await repository.appendSuspensionActivity(issueId, suspendUpdateInput)
      updatedIssue = await repository.closeSuspensionIssue(issueId, closeIssueUpdateInput)
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

    // 7. Construct the channel update input for either a user or mod
    let channelUpdateInput: ChannelUpdateInput | ServerConfigUpdateInput | null = null
    if (relatedAccountType === 'User') {
      channelUpdateInput = {
        SuspendedUsers: [
          {
            create: [
              {
                node: {
                  // Create Suspension, which contains the length
                  // of the suspension and the reason for it.
                  channelUniqueName: channelUniqueName,
                  serverName: scope === 'server' ? actionChannelName : null,
                  username: relatedAccountName,
                  suspendedUntil: suspendUntil,
                  suspendedIndefinitely: suspendIndefinitely,
                  RelatedIssue: {
                    connect: {
                      where: {
                        node: {
                          id: issueId
                        }
                      }
                    }
                  },
                  SuspendedUser: {
                    connect: {
                      where: {
                        node: {
                          username: relatedAccountName
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        ]
      }
    } else if (relatedAccountType === 'ModerationProfile') {
      channelUpdateInput = {
        SuspendedMods: [
          {
            create: [
              {
                // Create Suspension, which contains the length
                // of the suspension and the reason for it.
                node: {
                  channelUniqueName: channelUniqueName,
                  serverName: scope === 'server' ? actionChannelName : null,
                  username,
                  modProfileName: relatedAccountName,
                  suspendedUntil: suspendUntil,
                  suspendedIndefinitely: suspendIndefinitely,
                  SuspendedMod: {
                    connect: {
                      where: {
                        node: {
                          displayName: relatedAccountName
                        }
                      }
                    }
                  },
                  RelatedIssue: {
                    connect: {
                      where: {
                        node: {
                          id: issueId
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        ]
      }
    }

    // 8. Update the scope owner with the suspension relationship
    if (channelUpdateInput) {
      try {
        if (scope === 'server') {
          const serverData = await repository.addServerSuspension(process.env.SERVER_CONFIG_NAME, channelUpdateInput as ServerConfigUpdateInput)

          const updatedServer = serverData.serverConfigs?.[0] || null
          if (!updatedServer?.serverName) {
            throw new GraphQLError('Error updating server config')
          }
        } else {
          const channelData = await repository.addChannelSuspension(channelUniqueName, channelUpdateInput as ChannelUpdateInput)

          const updatedChannel = channelData.channels?.[0] || null
          if (!updatedChannel?.uniqueName) {
            throw new GraphQLError('Error updating channel')
          }
        }
      } catch (err) {
        throw new GraphQLError('Error updating channel')
      }
    }

    // 9. Finally, return the updatedIssue’s single Issue node (or null if it’s missing)
    return updatedIssueNode || null
  }
}
