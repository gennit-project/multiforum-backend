import type {
  Issue,
  IssueModel,
  CommentModel,
  ModerationActionCreateInput,
  IssueWhere,
  IssueUpdateInput,
  CommentUpdateInput,
  CommentWhere
} from '../../ogm_types.js'
import { setUserDataOnContext } from '../../rules/permission/userDataHelperFunctions.js'
import { GraphQLError } from 'graphql'
import { getModerationActionCreateInput } from './reportComment.js'

type Args = {
  commentId: string
  explanation: string
}

type Input = {
  Issue: IssueModel
  Comment: CommentModel
}

const getResolver = (input: Input) => {
  const { Issue, Comment } = input
  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { commentId, explanation } = args

    if (!commentId) {
      throw new GraphQLError('Comment ID is required')
    }
    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false
    })

    const loggedInUsername = context.user?.username || null
    if (!loggedInUsername) {
      throw new GraphQLError('User must be logged in')
    }

    const loggedInModName = context.user.data.ModerationProfile.displayName
    if (!loggedInModName) {
      throw new GraphQLError(`User ${loggedInUsername} is not a moderator`)
    }

    let existingIssueId = ''
    let existingIssue: Issue | null = null

    const commentData = await Comment.find({
      where: {
        id: commentId
      },
      selectionSet: `{
              id
              text
              Channel {
                uniqueName
              }
              DiscussionChannel {
                channelUniqueName
              }
              Event {
                EventChannels {
                  channelUniqueName
                }
              }
              ParentComment {
                Channel {
                  uniqueName
                }
                DiscussionChannel {
                  channelUniqueName
                }
                Event {
                  EventChannels {
                    channelUniqueName
                  }
                }
              }
          }`
    })
    const channelUniqueName =
      commentData[0]?.Channel?.uniqueName ||
      commentData[0]?.DiscussionChannel?.channelUniqueName ||
      commentData[0]?.Event?.EventChannels?.[0]?.channelUniqueName ||
      commentData[0]?.ParentComment?.Channel?.uniqueName ||
      commentData[0]?.ParentComment?.DiscussionChannel?.channelUniqueName ||
      commentData[0]?.ParentComment?.Event?.EventChannels?.[0]?.channelUniqueName ||
      ''
    if (!channelUniqueName) {
      throw new GraphQLError(
        'Could not find the forum name attached to the comment.'
      )
    }

    // Check if an issue already exists for the comment ID and channel unique name.
    const issueData = await Issue.find({
      where: {
        channelUniqueName: channelUniqueName,
        relatedCommentId: commentId
      },
      selectionSet: `{
              id
              issueNumber
              flaggedServerRuleViolation
          }`
    })

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || ''
      existingIssue = issueData[0]
    } else {
      throw new GraphQLError('Issue not found')
    }

    const unarchiveModActionCreateInput: ModerationActionCreateInput =
      getModerationActionCreateInput({
        text: explanation,
        loggedInModName,
        channelUniqueName,
        actionType: 'un-archive',
        actionDescription: 'Un-archived the comment',
        issueId: existingIssueId
      })
    console.log(
      'unarchiveModActionCreateInput',
      JSON.stringify(unarchiveModActionCreateInput)
    )

    const closeIssueModActionCreateInput: ModerationActionCreateInput =
      getModerationActionCreateInput({
        text: explanation,
        loggedInModName,
        channelUniqueName,
        actionType: 'close-issue',
        actionDescription: 'Closed the issue',
        issueId: existingIssueId
      })
    console.log(
      'closeIssueModActionCreateInput',
      JSON.stringify(closeIssueModActionCreateInput)
    )
    // Update the issue with the new moderation action.
    const issueUpdateWhere: IssueWhere = {
      id: existingIssueId
    }
    const unarchiveCreateInput: IssueUpdateInput = {
      ActivityFeed: [
        {
          create: [
            {
              node: unarchiveModActionCreateInput
            }
          ]
        }
      ]
    }
    const issueCloseCreateInput: IssueUpdateInput = {
      isOpen: false, // Close the issue; un-archival is often the final action.
      ActivityFeed: [
        {
          create: [
            {
              node: closeIssueModActionCreateInput
            }
          ]
        }
      ]
    }

    try {
      await Issue.update({
        where: issueUpdateWhere,
        update: unarchiveCreateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`
      })
      const issueData = await Issue.update({
        where: issueUpdateWhere,
        update: issueCloseCreateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`
      })
      console.log('issueData', JSON.stringify(issueData))
      const issueId = issueData.issues[0]?.id || null
      if (!issueId) {
        throw new GraphQLError('Error updating issue')
      }
      existingIssue = issueData.issues[0]
    } catch (error) {
      throw new GraphQLError('Error updating issue')
    }

    try {
      // Update the comment so that archived=false.
      const commentUpdateWhere: CommentWhere = {
        id: commentId
      }
      const commentUpdateInput: CommentUpdateInput = {
        archived: false
      }
      const commentUpdateData = await Comment.update({
        where: commentUpdateWhere,
        update: commentUpdateInput
      })
      const commentUpdateId = commentUpdateData.comments[0]?.id || null
      if (!commentUpdateId) {
        throw new GraphQLError('Error updating comment')
      }
      return existingIssue
    } catch (error) {
      throw new GraphQLError('Error updating comment')
    }
  }
}

export default getResolver
