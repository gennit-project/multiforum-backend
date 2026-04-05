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

type CreateUnsuspendResolverOptions = {
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

  unsuspendCommentText: string
}

type Args = {
  issueId: string
  explanation: string
}

export function createUnsuspendResolver ({
  Issue,
  Channel,
  Discussion,
  Event,
  Comment,
  suspendedEntityName,
}: CreateUnsuspendResolverOptions) {
  return async function unsuspendEntityResolver (
    parent: any,
    args: Args,
    context: any,
    resolveInfo: any
  ) {
    const { issueId, explanation } = args

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
    const unsuspendModActionCreateInput = getModerationActionCreateInput({
      text: explanation,
      loggedInModName,
      channelUniqueName,
      actionType: 'unsuspend',
      actionDescription: `Unsuspended ${relatedAccountName}`,
      issueId
    })
    const closeIssueModActionCreateInput = getModerationActionCreateInput({
      loggedInModName,
      channelUniqueName,
      actionType: 'close',
      actionDescription: 'Closed the issue after unsuspending the user',
      issueId
    })

    const issueUpdateInput: IssueUpdateInput = {
      isOpen: false, // Close issue; unsuspension is often the final action.
      ActivityFeed: [
        {
          create: [
            { node: closeIssueModActionCreateInput },
            { node: unsuspendModActionCreateInput },
           
          ]
        }
      ]
    }

    // 6. Update the Issue with the ModerationAction
    let updatedIssue
    try {
      updatedIssue = await Issue.update({
        where: { id: issueId },
        update: issueUpdateInput,
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
      actionType: 'unsuspend',
      actionDescription: `Unsuspended ${relatedAccountName}`,
      commentText: explanation
    })

    // 7. Construct the channel update input for either a user or mod
    let channelUpdateInput = null
    if (relatedAccountType === 'User') {
      channelUpdateInput = {
        SuspendedUsers: [
          {
            disconnect: [
              {
               where: {
                  node: {
                    SuspendedUser: {
                      username: relatedAccountName
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
            disconnect: [
              {
                where: {
                  node: {
                    SuspendedMod: {
                      displayName: relatedAccountName
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
        await Channel.update({
          where: { uniqueName: channelUniqueName },
          update: channelUpdateInput
        })
      } catch (err) {
        throw new GraphQLError('Error unsuspending user')
      }
    }

    // 9. Finally, return the updatedIssue’s single Issue node (or null if it’s missing)
    return updatedIssueNode || null
  }
}
