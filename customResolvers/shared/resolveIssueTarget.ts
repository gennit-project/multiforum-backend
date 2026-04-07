import { GraphQLError } from 'graphql'
import type {
  CommentModel,
  DiscussionModel,
  EventModel,
  IssueModel,
  ModerationProfile,
  User,
} from '../../ogm_types.js'

type ResolveIssueTargetInput = {
  Issue: IssueModel
  Comment: CommentModel
  Discussion: DiscussionModel
  Event: EventModel
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
}

const isUser = (data: User | ModerationProfile): data is User =>
  (data as User).username !== undefined

export async function resolveIssueTarget({
  Issue,
  Comment,
  Discussion,
  Event,
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

  if (scope === 'server') {
    if (
      suspendedEntityName === 'mod' &&
      foundIssue.relatedModProfileName
    ) {
      return {
        issue: foundIssue,
        channelUniqueName: null,
        scope,
        relatedAccountName: foundIssue.relatedModProfileName,
        relatedAccountType: 'ModerationProfile',
        modProfileName: foundIssue.relatedModProfileName,
      }
    }

    if (foundIssue.relatedUsername) {
      return {
        issue: foundIssue,
        channelUniqueName: null,
        scope,
        relatedAccountName: foundIssue.relatedUsername,
        relatedAccountType: 'User',
        username: foundIssue.relatedUsername,
      }
    }

    throw new GraphQLError(
      `Could not find the ${suspendedEntityName} account name to be suspended.`
    )
  }

  let originalPosterData: User | ModerationProfile | null = null

  if (foundIssue.relatedDiscussionId) {
    const [discussion] = await Discussion.find({
      where: { id: foundIssue.relatedDiscussionId },
      selectionSet: `{ id Author { username } }`,
    })
    originalPosterData = discussion?.Author || null
  }

  if (foundIssue.relatedEventId) {
    const [event] = await Event.find({
      where: { id: foundIssue.relatedEventId },
      selectionSet: `{ id Poster { username } }`,
    })
    originalPosterData = event?.Poster || null
  }

  if (foundIssue.relatedCommentId) {
    const [comment] = await Comment.find({
      where: { id: foundIssue.relatedCommentId },
      selectionSet: `{
        id
        CommentAuthor {
          ... on User { username }
          ... on ModerationProfile { displayName }
        }
      }`,
    })
    originalPosterData = comment?.CommentAuthor || null
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
  }
}
