import { GraphQLError } from 'graphql'
import type {
  CommentModel,
  DiscussionModel,
  EventModel,
  IssueModel,
  ModerationProfile,
  TextVersionModel,
  User,
  UserModel,
  WikiPageModel,
} from '../../ogm_types.js'

type ResolveIssueTargetInput = {
  Issue: IssueModel
  Comment: CommentModel
  Discussion: DiscussionModel
  Event: EventModel
  User: UserModel
  WikiPage?: WikiPageModel
  TextVersion?: TextVersionModel
  issueId: string
  suspendedEntityName?: 'user' | 'mod'
}

type IssueTarget = {
  issue: {
    id?: string | null
    channelUniqueName?: string | null
    relatedDiscussionId?: string | null
    relatedEventId?: string | null
    relatedCommentId?: string | null
    relatedWikiPageId?: string | null
    relatedWikiRevisionId?: string | null
    relatedUsername?: string | null
    relatedModProfileName?: string | null
    Channel?: { uniqueName?: string | null } | null
  }
  channelUniqueName: string | null
  scope: 'channel' | 'server'
  relatedAccountName: string
  relatedAccountType: 'User' | 'ModerationProfile'
  username?: string
  modProfileName?: string
  isBot: boolean
}

const isUser = (data: User | ModerationProfile): data is User =>
  (data as User).username !== undefined

export async function resolveIssueTarget({
  Issue,
  Comment,
  Discussion,
  Event,
  User,
  WikiPage,
  TextVersion,
  issueId,
  suspendedEntityName = 'user',
}: ResolveIssueTargetInput): Promise<IssueTarget> {
  if (!issueId) {
    throw new GraphQLError('Issue ID is required')
  }

  const [foundIssue] = await Issue.find({
    where: { id: issueId },
    selectionSet: `{
      id
      channelUniqueName
      relatedDiscussionId
      relatedEventId
      relatedCommentId
      relatedWikiPageId
      relatedWikiRevisionId
      relatedUsername
      relatedModProfileName
      Channel { uniqueName }
    }`,
  })

  if (!foundIssue) {
    throw new GraphQLError('Issue not found')
  }

  const channelUniqueName = foundIssue.Channel?.uniqueName || null
  const scope = channelUniqueName ? 'channel' : 'server'

  if (
    suspendedEntityName === 'mod' &&
    foundIssue.relatedModProfileName
  ) {
    return {
      issue: foundIssue,
      channelUniqueName,
      scope,
      relatedAccountName: foundIssue.relatedModProfileName,
      relatedAccountType: 'ModerationProfile',
      modProfileName: foundIssue.relatedModProfileName,
      isBot: false,
    }
  }

  if (foundIssue.relatedUsername) {
    // Query user to check if they are a bot
    const [relatedUser] = await User.find({
      where: { username: foundIssue.relatedUsername },
      selectionSet: `{ username isBot }`,
    })
    return {
      issue: foundIssue,
      channelUniqueName,
      scope,
      relatedAccountName: foundIssue.relatedUsername,
      relatedAccountType: 'User',
      username: foundIssue.relatedUsername,
      isBot: relatedUser?.isBot ?? false,
    }
  }

  if (scope === 'server') {
    throw new GraphQLError(
      `Could not find the ${suspendedEntityName} account name to be suspended.`
    )
  }

  let originalPosterData: User | ModerationProfile | null = null

  if (foundIssue.relatedDiscussionId) {
    const [discussion] = await Discussion.find({
      where: { id: foundIssue.relatedDiscussionId },
      selectionSet: `{ id Author { username isBot } }`,
    })
    originalPosterData = discussion?.Author || null
  }

  if (foundIssue.relatedEventId) {
    const [event] = await Event.find({
      where: { id: foundIssue.relatedEventId },
      selectionSet: `{ id Poster { username isBot } }`,
    })
    originalPosterData = event?.Poster || null
  }

  if (foundIssue.relatedCommentId) {
    const [comment] = await Comment.find({
      where: { id: foundIssue.relatedCommentId },
      selectionSet: `{
        id
        CommentAuthor {
          ... on User { username isBot }
          ... on ModerationProfile { displayName }
        }
      }`,
    })
    originalPosterData = comment?.CommentAuthor || null
  }

  if (foundIssue.relatedWikiRevisionId && TextVersion) {
    const [revision] = await TextVersion.find({
      where: { id: foundIssue.relatedWikiRevisionId },
      selectionSet: `{ id Author { username isBot } }`,
    })
    originalPosterData = revision?.Author || null
  }

  if (!originalPosterData && foundIssue.relatedWikiPageId && WikiPage) {
    const [wikiPage] = await WikiPage.find({
      where: { id: foundIssue.relatedWikiPageId },
      selectionSet: `{
        id
        OriginalAuthor { username isBot }
        VersionAuthor { username isBot }
      }`,
    })
    originalPosterData =
      wikiPage?.OriginalAuthor || wikiPage?.VersionAuthor || null
  }

  if (!originalPosterData) {
    throw new GraphQLError(
      `Could not find the ${suspendedEntityName} account name to be suspended.`
    )
  }

  if (!isUser(originalPosterData)) {
    if (!originalPosterData.displayName) {
      throw new GraphQLError(
        `Could not find the ${suspendedEntityName} account name to be suspended.`
      )
    }

    return {
      issue: foundIssue,
      channelUniqueName,
      scope,
      relatedAccountName: originalPosterData.displayName,
      relatedAccountType: 'ModerationProfile',
      modProfileName: originalPosterData.displayName,
      isBot: false,
    }
  }

  if (!originalPosterData.username) {
    throw new GraphQLError(
      `Could not find the ${suspendedEntityName} account name to be suspended.`
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
