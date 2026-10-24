import { createCommentReportRepository, type CommentReportRepository } from "../../services/persistence/commentReportRepository.js"
import { formatModerationActionText } from "../../services/persistence/moderationIssueWrites.js"
import { setUserDataOnContext } from '../../rules/permission/userDataHelperFunctions.js'
import { GraphQLError } from 'graphql'
import { getFinalCommentText } from "./shared/reportText.js"
import type { Driver } from 'neo4j-driver'
import type { GraphQLResolveInfo } from 'graphql'
import type { GraphQLContext } from '../../types/context.js'
import getNextIssueNumber from './utils/getNextIssueNumber.js'

type Args = {
  commentId: string
  reportText: string
  selectedForumRules: string[]
  selectedServerRules: string[]
  channelUniqueName: string
}

type Input = {
  commentReportRepository?: CommentReportRepository
  driver: Driver
}

type IssueCommentAuthor =
  | {
      __typename?: 'User'
      username?: string | null
    }
  | {
      __typename?: 'ModerationProfile'
      displayName?: string | null
    }
  | null
  | undefined

export const getRelatedIssueAccountFields = (
  commentAuthor: IssueCommentAuthor
): {
  relatedUsername?: string
  relatedModProfileName?: string
} => {
  if (commentAuthor?.__typename === 'User') {
    return {
      relatedUsername: commentAuthor.username ?? undefined
    }
  }

  if (commentAuthor?.__typename === 'ModerationProfile') {
    return {
      relatedModProfileName: commentAuthor.displayName ?? undefined
    }
  }

  return {}
}

const getResolver = (input: Input) => {
  const { driver } = input
  const repository = input.commentReportRepository ?? createCommentReportRepository(driver)
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const {
      commentId,
      reportText,
      selectedForumRules,
      selectedServerRules,
      channelUniqueName
    } = args

    if (!commentId) {
      throw new GraphQLError('Comment ID is required')
    }
    if (!channelUniqueName) {
      throw new GraphQLError('Channel unique name is required')
    }

    const atLeastOneViolation =
      selectedForumRules?.length > 0 || selectedServerRules?.length > 0

    if (!atLeastOneViolation) {
      throw new GraphQLError('At least one rule must be selected')
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
    let existingIssueFlaggedServerRuleViolation = false

    // Check if an issue already exists for the comment ID and channel unique name.
    const issueData = await repository.findExisting(channelUniqueName, commentId)

    if (issueData.length > 0) {
      existingIssueId = issueData[0]?.id || ''
      existingIssueFlaggedServerRuleViolation =
        issueData[0]?.flaggedServerRuleViolation || false
    }

    const finalCommentText = getFinalCommentText({
      reportText,
      selectedForumRules,
      selectedServerRules
    })

    const commentData = await repository.findComment(commentId)
    const commentText = commentData[0]?.text || ''
    const {
      relatedUsername,
      relatedModProfileName
    } = getRelatedIssueAccountFields(commentData[0]?.CommentAuthor)

    // If an issue does NOT already exist, create a new issue.
    if (!existingIssueId) {
      const issueNumber = await getNextIssueNumber(driver, channelUniqueName)
      const truncatedContextText = commentText?.substring(0, 50) || ''
      const title = `[Reported comment] "${truncatedContextText}${
        commentText.length > 50 ? '...' : ''
      }"`
      try {
        const issueData = await repository.createIssue({
          issueNumber,
          title,
          authorModName: loggedInModName,
          channelUniqueName,
          flaggedServerRuleViolation: selectedServerRules.length > 0,
          relatedCommentId: commentId,
          relatedUsername,
          relatedModProfileName
        })
        const issueId = issueData.issues[0]?.id || null
        if (!issueId) {
          throw new GraphQLError('Error creating issue')
        }
        existingIssueId = issueId
      } catch (error) {
        throw new GraphQLError('Error creating issue')
      }
    }

    // Append the report moderation action (with its embedded moderator comment)
    // to the issue's activity feed via the owned moderation write.
    try {
      const issueData = await repository.appendReport({
        issueId: existingIssueId,
        actions: [
          {
            actionType: 'report',
            actionDescription: 'Reported the comment',
            text: formatModerationActionText({ text: finalCommentText }),
            modDisplayName: loggedInModName,
            commentChannelUniqueName: channelUniqueName
          }
        ],
        isOpen: true, // Reopen the issue if it was closed
        flaggedServerRuleViolation:
          existingIssueFlaggedServerRuleViolation ||
          selectedServerRules.length > 0
      })
      const issueId = issueData.issues[0]?.id || null
      if (!issueId) {
        throw new GraphQLError('Error updating issue')
      }
      return issueData.issues[0]
    } catch (error) {
      throw new GraphQLError('Error updating issue')
    }
  }
}

export default getResolver
