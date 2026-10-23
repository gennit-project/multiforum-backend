import {createWikiEditReportRepository,type WikiEditReportRepository} from "../../services/persistence/wikiEditReportRepository.js";
import { GraphQLError } from 'graphql'
import type { GraphQLResolveInfo } from 'graphql'
import type { Driver } from 'neo4j-driver'
import type { GraphQLContext } from '../../types/context.js'
import type {
  IssueCreateInput,
  IssueUpdateInput,
  IssueWhere,
  ModerationActionCreateInput,
} from '../../ogm_types.js'
import { setUserDataOnContext } from '../../rules/permission/userDataHelperFunctions.js'
import {
  getIssueCreateInput,
  getModerationActionCreateInput
} from './reportComment.js'
import { getFinalCommentText } from "./shared/reportText.js"
import getNextIssueNumber from './utils/getNextIssueNumber.js'

type Args = {
  wikiPageId: string
  wikiRevisionId?: string | null
  reportText: string
  selectedForumRules: string[]
  selectedServerRules: string[]
  channelUniqueName: string
}

type Input = {
  wikiEditReportRepository?: WikiEditReportRepository
  driver: Driver
}

const getResolver = (input: Input) => {
  const { driver } = input
  const repository = input.wikiEditReportRepository ?? createWikiEditReportRepository(driver)

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const {
      wikiPageId,
      wikiRevisionId,
      reportText,
      selectedForumRules,
      selectedServerRules,
      channelUniqueName
    } = args

    if (!wikiPageId) {
      throw new GraphQLError('Wiki page ID is required')
    }

    if (!channelUniqueName) {
      throw new GraphQLError('Channel unique name is required')
    }

    const atLeastOneViolation =
      selectedForumRules?.length > 0 || selectedServerRules?.length > 0

    if (!atLeastOneViolation) {
      throw new GraphQLError('At least one rule must be selected')
    }

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

    const [wikiPage] = await repository.findReportedWiki(wikiPageId)

    if (!wikiPage) {
      throw new GraphQLError('Wiki page not found')
    }

    if (
      wikiPage.Channel?.uniqueName !== channelUniqueName
    ) {
      throw new GraphQLError('Wiki page does not belong to this channel')
    }

    let relatedUsername = wikiPage.VersionAuthor?.username || undefined
    let contextText = wikiPage.title || wikiPage.body || ''

    if (wikiRevisionId) {
      const [revision] = await repository.findReportedRevision(wikiRevisionId)

      if (!revision) {
        throw new GraphQLError('Wiki revision not found')
      }

      relatedUsername = revision.Author?.username || relatedUsername
      contextText = revision.body || contextText
    }

    const issueWhere: IssueWhere = {
      channelUniqueName: { eq: channelUniqueName },
      relatedWikiPageId: { eq: wikiPageId }
    }

    if (wikiRevisionId) {
      issueWhere.relatedWikiRevisionId = { eq: wikiRevisionId }
    }

    const issueData = await repository.findPriorWikiReport(issueWhere)

    let existingIssueId = ''
    let existingIssueFlaggedServerRuleViolation = false

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

    if (!existingIssueId) {
      const issueNumber = await getNextIssueNumber(driver, channelUniqueName)
      const issueCreateInput: IssueCreateInput = getIssueCreateInput({
        contextText,
        selectedForumRules,
        selectedServerRules,
        loggedInModName,
        channelUniqueName,
        reportedContentType: 'wiki edit',
        relatedWikiPageId: wikiPageId,
        relatedWikiRevisionId: wikiRevisionId || undefined,
        relatedUsername,
        issueNumber
      })

      try {
        const createdIssueData = await repository.createWikiReportIssue(issueCreateInput)
        const issueId = createdIssueData.issues[0]?.id || null
        if (!issueId) {
          throw new GraphQLError('Error creating issue')
        }
        existingIssueId = issueId
      } catch (error) {
        throw new GraphQLError('Error creating issue')
      }
    }

    const moderationActionCreateInput: ModerationActionCreateInput =
      getModerationActionCreateInput({
        text: finalCommentText,
        loggedInModName,
        channelUniqueName,
        actionType: 'report',
        actionDescription: 'Reported the wiki edit',
        issueId: existingIssueId
      })

    const issueUpdateWhere: IssueWhere = {
      id: { eq: existingIssueId }
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
      isOpen: { set: true },
      flaggedServerRuleViolation: {
        set:
          existingIssueFlaggedServerRuleViolation ||
          selectedServerRules.length > 0
      }
    }

    try {
      const updatedIssueData = await repository.appendWikiReport(issueUpdateWhere, issueUpdateInput)
      const issueId = updatedIssueData.issues[0]?.id || null
      if (!issueId) {
        throw new GraphQLError('Error updating issue')
      }
      return updatedIssueData.issues[0]
    } catch (error) {
      throw new GraphQLError('Error updating issue')
    }
  }
}

export default getResolver
