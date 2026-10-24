import { createCommentModerationRepository, type CommentModerationRepository } from "../../services/persistence/commentModerationRepository.js";
import type { Driver } from "neo4j-driver";
import type {
  Issue,
  CommentUpdateInput,
  CommentWhere
} from '../../ogm_types.js'
import { setUserDataOnContext } from '../../rules/permission/userDataHelperFunctions.js'
import { GraphQLError } from 'graphql'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import { formatModerationActionText } from '../../services/persistence/moderationIssueWrites.js'
import { notifyIssueSubscribers } from '../../services/issueNotifications.js'
import { logger } from "../../logger.js";

type Args = {
  commentId: string
  explanation: string
}

type Input = {
  repository?: CommentModerationRepository;
  driver: Driver;
}

const getResolver = (input: Input) => {
  const repository = input.repository ?? createCommentModerationRepository(input.driver)
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const { commentId, explanation } = args

    if (!commentId) {
      throw new GraphQLError('Comment ID is required')
    }
    // Set loggedInUsername to null explicitly if not present
    context.user = await setUserDataOnContext({
      context,
    })

    const loggedInUsername = context.user?.username || null
    if (!loggedInUsername) {
      throw new GraphQLError('User must be logged in')
    }

    const loggedInModName = context.user.data?.ModerationProfile?.displayName
    if (!loggedInModName) {
      throw new GraphQLError(`User ${loggedInUsername} is not a moderator`)
    }

    let existingIssueId = ''
    let existingIssue: Issue | null = null

    const commentData = await repository.findUnarchiveTarget(commentId)
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
    const issueData = await repository.findIssue(channelUniqueName, commentId)

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || ''
      existingIssue = issueData[0]
    } else {
      throw new GraphQLError('Issue not found')
    }

    // Record the un-archive action then the close action on the issue's activity
    // feed via the owned moderation write (two appends, same as before).
    const actionText = formatModerationActionText({ text: explanation })
    try {
      await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: 'un-archive',
            actionDescription: 'Un-archived the comment',
            text: actionText,
            modDisplayName: loggedInModName,
            commentChannelUniqueName: channelUniqueName
          }
        ]
      })
      const issueData = await repository.appendIssueAction({
        issueId: existingIssueId,
        actions: [
          {
            actionType: 'close-issue',
            actionDescription: 'Closed the issue',
            text: actionText,
            modDisplayName: loggedInModName,
            commentChannelUniqueName: channelUniqueName
          }
        ],
        isOpen: false // Close the issue; un-archival is often the final action.
      })
      logger.info('issueData', JSON.stringify(issueData))
      const issueId = issueData.issues[0]?.id || null
      if (!issueId) {
        throw new GraphQLError('Error updating issue')
      }
      existingIssue = issueData.issues[0]
      await notifyIssueSubscribers({
        notificationSnapshotRepository: context.notificationSnapshotRepository,
        driver: context.driver,
        issueId,
        actorUsername: loggedInUsername,
        actionType: 'un-archive',
        actionDescription: 'Un-archived the comment',
        commentText: explanation
      })
    } catch (error) {
      throw new GraphQLError('Error updating issue')
    }

    try {
      // Update the comment so that archived=false.
      const commentUpdateWhere: CommentWhere = {
        id: { eq: commentId }
      }
      const commentUpdateInput: CommentUpdateInput = {
        archived: { set: false }
      }
      const commentUpdateData = await repository.setArchived(commentUpdateWhere, commentUpdateInput)
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
