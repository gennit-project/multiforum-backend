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
    TargetDiscussion?: { id?: string | null } | null
    TargetEvent?: { id?: string | null } | null
    TargetComment?: { id?: string | null } | null
    TargetWikiPage?: { id?: string | null } | null
    TargetWikiRevision?: { id?: string | null } | null
    TargetUser?: { username?: string | null; isBot?: boolean | null } | null
    TargetModProfile?: { displayName?: string | null } | null
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

const findUsernameForModProfile = async ({
  User,
  displayName,
}: {
  User: UserModel
  displayName: string
}): Promise<string | undefined> => {
  const [profileOwner] = await User.find({
    where: { ModerationProfile: { displayName } },
    selectionSet: `{ username }`,
  })
  return profileOwner?.username || undefined
}

export async function resolveIssueTarget({
  Issue,
  Comment,
  Discussion,
  Event,
  User,
  WikiPage,
  TextVersion,
  issueId,
  suspendedEntityName,
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
      TargetDiscussion { id }
      TargetEvent { id }
      TargetComment { id }
      TargetWikiPage { id }
      TargetWikiRevision { id }
      TargetUser { username isBot }
      TargetModProfile { displayName }
    }`,
  })

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
      User,
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
    const [relatedUser] = await User.find({
      where: { username: relatedUsername },
      selectionSet: `{ username isBot }`,
    })
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

  let originalPosterData: User | ModerationProfile | null = null

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
    const [discussion] = await Discussion.find({
      where: { id: relatedDiscussionId },
      selectionSet: `{ id Author { username isBot } }`,
    })
    originalPosterData = discussion?.Author || null
  }

  if (relatedEventId) {
    const [event] = await Event.find({
      where: { id: relatedEventId },
      selectionSet: `{ id Poster { username isBot } }`,
    })
    originalPosterData = event?.Poster || null
  }

  if (relatedCommentId) {
    const [comment] = await Comment.find({
      where: { id: relatedCommentId },
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

  if (relatedWikiRevisionId && TextVersion) {
    const [revision] = await TextVersion.find({
      where: { id: relatedWikiRevisionId },
      selectionSet: `{ id Author { username isBot } }`,
    })
    originalPosterData = revision?.Author || null
  }

  if (!originalPosterData && relatedWikiPageId && WikiPage) {
    const [wikiPage] = await WikiPage.find({
      where: { id: relatedWikiPageId },
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
      User,
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
