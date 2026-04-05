import { GraphQLError } from 'graphql'
import type {
  ChannelModel,
  IssueModel,
  CommentModel,
  DiscussionModel,
  EventModel,
  IssueUpdateInput
} from '../../../ogm_types.js'
import { setUserDataOnContext } from '../../../rules/permission/userDataHelperFunctions.js'
import { getModerationActionCreateInput } from '../reportComment.js'
import { notifyIssueSubscribers } from '../../../services/issueNotifications.js'
import { resolveIssueTarget } from '../../shared/resolveIssueTarget.js'

type CreateSuspensionResolverOptions = {
  Issue: IssueModel
  Channel: ChannelModel
  Comment: CommentModel
  Discussion: DiscussionModel
  Event: EventModel

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
  Issue,
  Channel,
  Discussion,
  Event,
  Comment,
  suspendedEntityName,
}: CreateSuspensionResolverOptions) {
  return async function suspendEntityResolver (
    parent: any,
    args: Args,
    context: any,
    resolveInfo: any
  ) {
    const { issueId, suspendUntil, suspendIndefinitely, explanation } = args

    if (!issueId) {
      throw new GraphQLError('Issue ID is required')
    }

    const { channelUniqueName, relatedAccountName, relatedAccountType } =
      await resolveIssueTarget({
        Issue,
        Comment,
        Discussion,
        Event,
        issueId,
        suspendedEntityName,
      })

    // 4. Confirm the person calling this is indeed a moderator
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false
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
      channelUniqueName,
      actionType: 'suspension',
      actionDescription: `Suspended ${relatedAccountName}`,
      issueId,
      suspendUntil,
      suspendIndefinitely
    })

    const closeIssueModActionCreateInput = getModerationActionCreateInput({
      loggedInModName,
      channelUniqueName,
      actionType: 'close',
      actionDescription: 'Closed the issue while suspending the user',
      issueId
    })

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
      await Issue.update({
        where: { id: issueId },
        update: suspendUpdateInput,
      })
      updatedIssue = await Issue.update({
        where: { id: issueId },
        update: closeIssueUpdateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            ActivityFeed {
              id
              actionType
            }
          }
        }`
      })
    } catch (err) {
      throw new GraphQLError('Error updating issue')
    }

    const updatedIssueNode = updatedIssue?.issues?.[0] || null
    if (!updatedIssueNode?.id) {
      throw new GraphQLError('Unable to update Issue with ModerationAction')
    }

    await notifyIssueSubscribers({
      IssueModel: Issue,
      driver: context.driver,
      issueId,
      actorUsername: loggedInUsername,
      actionType: 'suspension',
      actionDescription: `Suspended ${relatedAccountName}`,
      commentText: explanation
    })

    // 7. Construct the channel update input for either a user or mod
    let channelUpdateInput = null
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

    // 8. Update the channel with the suspension relationship
    if (channelUpdateInput) {
      try {
        const channelData = await Channel.update({
          where: { uniqueName: channelUniqueName },
          update: channelUpdateInput,
          // If you need the updated fields
          selectionSet: `{
            channels {
              uniqueName
            }
          }`
        })

        const updatedChannel = channelData.channels?.[0] || null
        if (!updatedChannel?.uniqueName) {
          throw new GraphQLError('Error updating channel')
        }
      } catch (err) {
        throw new GraphQLError('Error updating channel')
      }
    }

    // 9. Finally, return the updatedIssue’s single Issue node (or null if it’s missing)
    return updatedIssueNode || null
  }
}
