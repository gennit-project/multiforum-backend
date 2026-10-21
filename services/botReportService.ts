import { createBotReportRepository, type BotReportRepository } from "./persistence/botReportRepository.js";
import type { BotIdentityRepository } from './persistence/botIdentityRepository.js'
import type { Driver } from 'neo4j-driver'
import type {
  IssueCreateInput,
  IssueUpdateInput,
  IssueWhere,
  ModerationActionCreateInput
} from '../ogm_types.js'
import { ensureBotUserForChannel } from './botUserService.js'
import {
  getIssueCreateInput,
  getModerationActionCreateInput
} from '../customResolvers/mutations/reportComment.js'
import { getFinalCommentText } from "../customResolvers/mutations/shared/reportText.js"
import getNextIssueNumber from '../customResolvers/mutations/utils/getNextIssueNumber.js'
import { logger } from "../logger.js";

type ReportContentAsBotInput = {
  contentType: 'comment' | 'discussion' | 'event'
  contentId: string
  reportText: string
  selectedForumRules: string[]
  selectedServerRules: string[]
  botName: string
  profileId?: string | null
  profileLabel?: string | null
}

type ReportContentAsBotResult = {
  issueId: string
  issueNumber: number
} | null

/**
 * Creates or updates a moderation issue report on behalf of a bot user.
 * The bot user is automatically ensured to exist and have a ModerationProfile.
 */
export const createBotReport = async (input: {
  botReportRepository?: BotReportRepository
  botIdentityRepository?: BotIdentityRepository
  driver: Driver
  channelUniqueName: string
  reportInput: ReportContentAsBotInput
}): Promise<ReportContentAsBotResult> => {
  const { driver, channelUniqueName, reportInput } = input
  const {
    contentType,
    contentId,
    reportText,
    selectedForumRules,
    selectedServerRules,
    botName,
    profileId,
    profileLabel
  } = reportInput

  const repository = input.botReportRepository ?? createBotReportRepository(driver)

  if (!contentId) {
    throw new Error(`${contentType} ID is required`)
  }
  if (!channelUniqueName) {
    throw new Error('Channel unique name is required')
  }

  const atLeastOneViolation =
    selectedForumRules?.length > 0 || selectedServerRules?.length > 0

  if (!atLeastOneViolation) {
    throw new Error('At least one rule must be selected')
  }

  // Ensure the bot user exists and has a ModerationProfile
  const botUser = await ensureBotUserForChannel({
    driver,
    repository: input.botIdentityRepository,
    channelUniqueName,
    botName,
    profileId,
    profileLabel
  })

  // The bot's ModerationProfile displayName is the username
  const botModName = botUser.username

  let existingIssueId = ''
  let existingIssueFlaggedServerRuleViolation = false
  let contextText = ''

  // Check if an issue already exists for this content
  const issueWhereClause: IssueWhere = {
    channelUniqueName
  }

  switch (contentType) {
    case 'comment':
      issueWhereClause.relatedCommentId = contentId
      break
    case 'discussion':
      issueWhereClause.relatedDiscussionId = contentId
      break
    case 'event':
      issueWhereClause.relatedEventId = contentId
      break
  }

  const existingIssues = await repository.findExistingReport(issueWhereClause)

  if (existingIssues.length > 0) {
    existingIssueId = existingIssues[0]?.id || ''
    existingIssueFlaggedServerRuleViolation =
      existingIssues[0]?.flaggedServerRuleViolation || false
  }

  // Get context text and related user info based on content type
  let relatedUsername: string | undefined
  let relatedModProfileName: string | undefined

  switch (contentType) {
    case 'comment': {
      const commentData = await repository.findReportedComment(contentId)
      contextText = commentData[0]?.text || ''
      const author = commentData[0]?.CommentAuthor
      if (author?.__typename === 'User') {
        relatedUsername = author.username ?? undefined
      } else if (author?.__typename === 'ModerationProfile') {
        relatedModProfileName = author.displayName ?? undefined
      }
      break
    }
    case 'discussion': {
      const discussionData = await repository.findReportedDiscussion(contentId)
      contextText = discussionData[0]?.title || ''
      relatedUsername = discussionData[0]?.Author?.username ?? undefined
      break
    }
    case 'event': {
      const eventData = await repository.findReportedEvent(contentId)
      contextText = eventData[0]?.title || ''
      relatedUsername = eventData[0]?.Poster?.username ?? undefined
      break
    }
  }

  const finalCommentText = getFinalCommentText({
    reportText,
    selectedForumRules,
    selectedServerRules
  })

  // If an issue does NOT already exist, create a new one
  if (!existingIssueId) {
    const issueNumber = await getNextIssueNumber(driver, channelUniqueName)
    const issueCreateInput: IssueCreateInput = getIssueCreateInput({
      contextText,
      selectedForumRules,
      selectedServerRules,
      loggedInModName: botModName,
      channelUniqueName,
      reportedContentType: contentType,
      relatedCommentId: contentType === 'comment' ? contentId : undefined,
      relatedDiscussionId: contentType === 'discussion' ? contentId : undefined,
      relatedEventId: contentType === 'event' ? contentId : undefined,
      relatedUsername,
      relatedModProfileName,
      issueNumber
    })

    try {
      const issueData = await repository.createReportedIssue([issueCreateInput])
      const issueId = issueData.issues[0]?.id || null
      if (!issueId) {
        throw new Error('Error creating issue')
      }
      existingIssueId = issueId
    } catch (error) {
      logger.error('Error creating issue:', error)
      throw new Error(`Error creating issue: ${(error as Error)?.message || 'unknown error'}`)
    }
  }

  // Create the moderation action for the report
  const moderationActionCreateInput: ModerationActionCreateInput =
    getModerationActionCreateInput({
      text: finalCommentText,
      loggedInModName: botModName,
      channelUniqueName,
      actionType: 'report',
      actionDescription: `Reported the ${contentType}`,
      issueId: existingIssueId
    })

  // Update the issue with the new moderation action
  const issueUpdateWhere: IssueWhere = {
    id: existingIssueId
  }
  const issueUpdateInput: IssueUpdateInput = {
    ActivityFeed: [
      {
        create: [
          {
            node: moderationActionCreateInput
          }
        ]
      }
    ],
    isOpen: true, // Reopen the issue if it was closed
    flaggedServerRuleViolation:
      existingIssueFlaggedServerRuleViolation || selectedServerRules.length > 0
  }

  const existingIssue = existingIssues[0]

  if (!existingIssue?.relatedUsername && relatedUsername) {
    issueUpdateInput.relatedUsername = relatedUsername
  }

  if (!existingIssue?.relatedModProfileName && relatedModProfileName) {
    issueUpdateInput.relatedModProfileName = relatedModProfileName
  }

  try {
    const issueData = await repository.appendBotReport(issueUpdateWhere, issueUpdateInput)
    const issue = issueData.issues[0]
    if (!issue?.id) {
      throw new Error('Error updating issue')
    }
    return {
      issueId: issue.id,
      issueNumber: issue.issueNumber ?? 0
    }
  } catch (error) {
    logger.error('Error updating issue:', error)
    throw new Error(`Error updating issue: ${(error as Error)?.message || 'unknown error'}`)
  }
}
