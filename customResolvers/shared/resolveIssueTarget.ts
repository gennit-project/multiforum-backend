import { GraphQLError } from 'graphql'
import type { IssueTargetRepository, IssueTargetSnapshot, IssueTargetUser, IssueTargetMod } from '../../services/persistence/issueTargetRepository.js'

type ResolveIssueTargetInput = {
  repository: IssueTargetRepository
  includeWikiPage?: boolean
  includeTextVersion?: boolean
  issueId: string
  suspendedEntityName?: 'user' | 'mod'
}

type IssueTarget = {
  issue: IssueTargetSnapshot
  channelUniqueName: string | null
  scope: 'channel' | 'server'
  relatedAccountName: string
  relatedAccountType: 'User' | 'ModerationProfile'
  username?: string
  modProfileName?: string
  isBot: boolean
}

const isUser = (data: IssueTargetUser | IssueTargetMod): data is IssueTargetUser =>
  (data as IssueTargetUser).username !== undefined

const findUsernameForModProfile = async ({
  repository,
  displayName,
}: {
  repository: IssueTargetRepository
  displayName: string
}): Promise<string | undefined> => {
  const [profileOwner] = await repository.findProfileOwner(displayName)
  return profileOwner?.username || undefined
}

export async function resolveIssueTarget({
  repository,
  includeWikiPage = false,
  includeTextVersion = false,
  issueId,
  suspendedEntityName,
}: ResolveIssueTargetInput): Promise<IssueTarget> {
  if (!issueId) {
    throw new GraphQLError('Issue ID is required')
  }

  const [foundIssue] = await repository.findIssue(issueId)

  if (!foundIssue) {
    throw new GraphQLError('Issue not found')
  }

  const channelUniqueName = foundIssue.Channel?.uniqueName || null
  const scope = channelUniqueName ? 'channel' : 'server'
  const resolvedEntityName =
    suspendedEntityName ||
    (foundIssue.TargetModProfile?.displayName || foundIssue.relatedModProfileName
      ? 'mod'
      : 'user')

  const relatedModProfileName =
    foundIssue.TargetModProfile?.displayName || foundIssue.relatedModProfileName
  const relatedUsername =
    foundIssue.TargetUser?.username || foundIssue.relatedUsername

  if (
    resolvedEntityName === 'mod' &&
    relatedModProfileName
  ) {
    const username = await findUsernameForModProfile({
      repository,
      displayName: relatedModProfileName,
    })
    return {
      issue: foundIssue,
      channelUniqueName,
      scope,
      relatedAccountName: relatedModProfileName,
      relatedAccountType: 'ModerationProfile',
      username,
      modProfileName: relatedModProfileName,
      isBot: false,
    }
  }

  if (relatedUsername) {
    // Query user to check if they are a bot
    const [relatedUser] = await repository.findDirectUser(relatedUsername)
    return {
      issue: foundIssue,
      channelUniqueName,
      scope,
      relatedAccountName: relatedUsername,
      relatedAccountType: 'User',
      username: relatedUsername,
      isBot: foundIssue.TargetUser?.isBot ?? relatedUser?.isBot ?? false,
    }
  }

  if (scope === 'server') {
    throw new GraphQLError(
      `Could not find the ${resolvedEntityName} account name to be suspended.`
    )
  }

  let originalPosterData: IssueTargetUser | IssueTargetMod | null = null

  const relatedDiscussionId =
    foundIssue.TargetDiscussion?.id || foundIssue.relatedDiscussionId
  const relatedEventId = foundIssue.TargetEvent?.id || foundIssue.relatedEventId
  const relatedCommentId =
    foundIssue.TargetComment?.id || foundIssue.relatedCommentId
  const relatedWikiRevisionId =
    foundIssue.TargetWikiRevision?.id || foundIssue.relatedWikiRevisionId
  const relatedWikiPageId =
    foundIssue.TargetWikiPage?.id || foundIssue.relatedWikiPageId

  if (relatedDiscussionId) {
    const [discussion] = await repository.findDiscussionAuthor(relatedDiscussionId)
    originalPosterData = discussion?.Author || null
  }

  if (relatedEventId) {
    const [event] = await repository.findEventPoster(relatedEventId)
    originalPosterData = event?.Poster || null
  }

  if (relatedCommentId) {
    const [comment] = await repository.findCommentAuthor(relatedCommentId)
    originalPosterData = comment?.CommentAuthor || null
  }

  if (relatedWikiRevisionId && includeTextVersion) {
    const [revision] = await repository.findRevisionAuthor(relatedWikiRevisionId)
    originalPosterData = revision?.Author || null
  }

  if (!originalPosterData && relatedWikiPageId && includeWikiPage) {
    const [wikiPage] = await repository.findWikiAuthors(relatedWikiPageId)
    originalPosterData =
      wikiPage?.OriginalAuthor || wikiPage?.VersionAuthor || null
  }

  if (!originalPosterData) {
    throw new GraphQLError(
      `Could not find the ${resolvedEntityName} account name to be suspended.`
    )
  }

  if (!isUser(originalPosterData)) {
    if (!originalPosterData.displayName) {
      throw new GraphQLError(
        `Could not find the ${resolvedEntityName} account name to be suspended.`
      )
    }

    const username = await findUsernameForModProfile({
      repository,
      displayName: originalPosterData.displayName,
    })
    return {
      issue: foundIssue,
      channelUniqueName,
      scope,
      relatedAccountName: originalPosterData.displayName,
      relatedAccountType: 'ModerationProfile',
      username,
      modProfileName: originalPosterData.displayName,
      isBot: false,
    }
  }

  if (!originalPosterData.username) {
    throw new GraphQLError(
      `Could not find the ${resolvedEntityName} account name to be suspended.`
    )
  }

  return {
    issue: foundIssue,
    channelUniqueName,
    scope,
    relatedAccountName: originalPosterData.username,
    relatedAccountType: 'User',
    username: originalPosterData.username,
    isBot: originalPosterData.isBot ?? false,
  }
}
