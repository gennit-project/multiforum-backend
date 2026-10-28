import { createBotReportRepository, type BotReportRepository } from "./persistence/botReportRepository.js";
import type { BotIdentityRepository } from './persistence/botIdentityRepository.js'
import type { Driver } from 'neo4j-driver'
import {
  ModerationRecommendedAction,
  type IssueWhere
} from '../ogm_types.js'
import { ensureBotUserForChannel } from './botUserService.js'
import { formatModerationActionText } from './persistence/moderationIssueWrites.js'
import { getFinalCommentText } from "../customResolvers/mutations/shared/reportText.js"
import getNextIssueNumber from '../customResolvers/mutations/utils/getNextIssueNumber.js'
import { logger } from "../logger.js";

export type ReportContentAsBotInput = {
  contentType: 'comment' | 'discussion' | 'event'
  contentId: string
  reportText: string
  selectedForumRules: string[]
  selectedServerRules: string[]
  botName: string
  profileId?: string | null
  profileLabel?: string | null
  recommendedAction?: 'edit' | 'remove' | null
  recommendationConfidence?: number | null
  recommendationRationale?: string | null
}

type ReportContentAsBotResult = {
  issueId: string
  issueNumber: number
} | null

export const normalizeBotRecommendation = (
  input: {
    recommendedAction?: unknown
    recommendationConfidence?: unknown
    recommendationRationale?: unknown
  }
) => {
  const recommendedAction = input.recommendedAction === 'edit'
    ? ModerationRecommendedAction.Edit
    : input.recommendedAction === 'remove'
      ? ModerationRecommendedAction.Remove
      : undefined
  const recommendationConfidence =
    typeof input.recommendationConfidence === 'number' &&
    Number.isFinite(input.recommendationConfidence) &&
    input.recommendationConfidence >= 0 &&
    input.recommendationConfidence <= 1
      ? input.recommendationConfidence
      : undefined
  const recommendationRationale =
    typeof input.recommendationRationale === 'string' &&
    input.recommendationRationale.trim()
      ? input.recommendationRationale.trim()
      : undefined

  return {
    recommendedAction,
    recommendationConfidence,
    recommendationRationale
  }
}

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
  idempotencyKey?: string | null
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
    channelUniqueName: { eq: channelUniqueName }
  }

  switch (contentType) {
    case 'comment':
      issueWhereClause.relatedCommentId = { eq: contentId }
      break
    case 'discussion':
      issueWhereClause.relatedDiscussionId = { eq: contentId }
      break
    case 'event':
      issueWhereClause.relatedEventId = { eq: contentId }
      break
  }

  const replayedIssue = input.idempotencyKey
    ? (await repository.findIdempotentReport(
        issueWhereClause,
        input.idempotencyKey
      ))[0]
    : undefined

  if (replayedIssue?.id) {
    return {
      issueId: replayedIssue.id,
      issueNumber: replayedIssue.issueNumber ?? 0
    }
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
  const recommendation = normalizeBotRecommendation(reportInput)

  // If an issue does NOT already exist, create a new one
  if (!existingIssueId) {
    const issueNumber = await getNextIssueNumber(driver, channelUniqueName)
    const title = `[Reported ${contentType}] "${contextText?.substring(0, 50) || ''}${
      contextText.length > 50 ? '...' : ''
    }"`

    try {
      const issueData = await repository.createReportedIssue([{
        issueNumber,
        title,
        authorModName: botModName,
        channelUniqueName,
        flaggedServerRuleViolation: selectedServerRules.length > 0,
        relatedCommentId: contentType === 'comment' ? contentId : undefined,
        relatedDiscussionId: contentType === 'discussion' ? contentId : undefined,
        relatedEventId: contentType === 'event' ? contentId : undefined,
        relatedUsername,
        relatedModProfileName,
      }])
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

  // Append the bot's report moderation action (with its embedded comment) via the
  // owned write, carrying the bot's idempotency key + recommendation fields.
  try {
    const issueData = await repository.appendBotReport({
      issueId: existingIssueId,
      actions: [
        {
          actionType: 'report',
          actionDescription: `Reported the ${contentType}`,
          text: formatModerationActionText({ text: finalCommentText }),
          modDisplayName: botModName,
          commentChannelUniqueName: channelUniqueName,
          idempotencyKey: input.idempotencyKey,
          ...recommendation
        }
      ],
      isOpen: true, // Reopen the issue if it was closed
      flaggedServerRuleViolation:
        existingIssueFlaggedServerRuleViolation || selectedServerRules.length > 0
    })
    const issue = issueData.issues[0]
    if (!issue?.id) {
      throw new Error('Error updating issue')
    }
    return {
      issueId: issue.id,
      issueNumber: issue.issueNumber ?? 0
    }
  } catch (error) {
    if (input.idempotencyKey) {
      const replayedIssue = (await repository.findIdempotentReport(
        issueWhereClause,
        input.idempotencyKey
      ))[0]
      if (replayedIssue?.id) {
        return {
          issueId: replayedIssue.id,
          issueNumber: replayedIssue.issueNumber ?? 0
        }
      }
    }
    logger.error('Error updating issue:', error)
    throw new Error(`Error updating issue: ${(error as Error)?.message || 'unknown error'}`)
  }
}
