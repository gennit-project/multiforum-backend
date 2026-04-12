import { GraphQLError } from 'graphql'
import type {
  IssueCreateInput,
  IssueModel,
  IssueUpdateInput,
  IssueWhere,
  ModerationActionCreateInput,
  TextVersionModel,
  WikiPageModel
} from '../../ogm_types.js'
import { setUserDataOnContext } from '../../rules/permission/userDataHelperFunctions.js'
import {
  getIssueCreateInput,
  getModerationActionCreateInput
} from './reportComment.js'
import { getFinalCommentText } from './reportDiscussion.js'
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
  Issue: IssueModel
  WikiPage: WikiPageModel
  TextVersion: TextVersionModel
  driver: any
}

const getResolver = (input: Input) => {
  const { Issue, WikiPage, TextVersion, driver } = input

  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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

    const [wikiPage] = await WikiPage.find({
      where: { id: wikiPageId },
      selectionSet: `{
        id
        title
        body
        channelUniqueName
        VersionAuthor {
          username
        }
      }`
    })

    if (!wikiPage) {
      throw new GraphQLError('Wiki page not found')
    }

    if (
      wikiPage.channelUniqueName &&
      wikiPage.channelUniqueName !== channelUniqueName
    ) {
      throw new GraphQLError('Wiki page does not belong to this channel')
    }

    let relatedUsername = wikiPage.VersionAuthor?.username || undefined
    let contextText = wikiPage.title || wikiPage.body || ''

    if (wikiRevisionId) {
      const [revision] = await TextVersion.find({
        where: { id: wikiRevisionId },
        selectionSet: `{
          id
          body
          Author {
            username
          }
        }`
      })

      if (!revision) {
        throw new GraphQLError('Wiki revision not found')
      }

      relatedUsername = revision.Author?.username || relatedUsername
      contextText = revision.body || contextText
    }

    const issueWhere: IssueWhere = {
      channelUniqueName,
      relatedWikiPageId: wikiPageId
    }

    if (wikiRevisionId) {
      issueWhere.relatedWikiRevisionId = wikiRevisionId
    }

    const issueData = await Issue.find({
      where: issueWhere,
      selectionSet: `{
        id
        issueNumber
        flaggedServerRuleViolation
        relatedUsername
      }`
    })

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
        const createdIssueData = await Issue.create({
          input: [issueCreateInput],
          selectionSet: `{
            issues {
              id
              issueNumber
              flaggedServerRuleViolation
            }
          }`
        })
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
      isOpen: true,
      flaggedServerRuleViolation:
        existingIssueFlaggedServerRuleViolation ||
        selectedServerRules.length > 0
    }

    const existingIssue = issueData[0]

    if (!existingIssue?.relatedUsername && relatedUsername) {
      issueUpdateInput.relatedUsername = relatedUsername
    }

    try {
      const updatedIssueData = await Issue.update({
        where: issueUpdateWhere,
        update: issueUpdateInput,
        selectionSet: `{
          issues {
            id
            issueNumber
            flaggedServerRuleViolation
          }
        }`
      })
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
