import type { BotThreadRepository, BotCommentSnapshot, BotCommentAuthorSnapshot } from "../persistence/botThreadRepository.js"
import { MAX_REPLY_DEPTH } from '../replyAncestry.js'

type BotChannelSnapshot = {
  uniqueName?: string | null
  displayName?: string | null
  description?: string | null
  rules?: unknown
}

type BotDiscussionSnapshot = {
  id?: string | null
  title?: string | null
  body?: string | null
}

type BotServerSnapshot = {
  rules?: unknown
}

export type BotThreadCommentContext = {
  id: string
  text: string
  authorUsername: string | null
  authorLabel: string
}

export type BotInvocationContext = {
  invocationType: string
  server: {
    rules: string[]
  }
  channel: {
    uniqueName: string
    displayName: string
    description: string | null
    rules: string[]
  }
  discussion: {
    id: string
    title: string
    body: string
  } | null
  comment: {
    id: string
    text: string
    authorUsername: string | null
    authorLabel: string
    parentCommentId: string | null
  } | null
  thread: {
    parentComments: BotThreadCommentContext[]
    rootCommentId: string | null
  }
}

const normalizeRules = (rules: unknown): string[] => {
  if (!Array.isArray(rules)) {
    return []
  }

  return rules.filter((rule): rule is string => typeof rule === 'string')
}

const getCommentAuthorInfo = (author: BotCommentAuthorSnapshot) => {
  const authorUsername = author?.username || author?.User?.username || null

  return {
    authorUsername,
    authorLabel: author?.displayName || authorUsername || 'Someone',
  }
}

export const collectParentCommentThread = async ({
  repository,
  parentCommentId,
}: {
  repository: BotThreadRepository
  parentCommentId?: string | null
}): Promise<BotThreadCommentContext[]> => {
  const parentComments: BotThreadCommentContext[] = []
  let currentParentCommentId = parentCommentId || null
  const visited = new Set<string>()

  while (
    currentParentCommentId &&
    parentComments.length < MAX_REPLY_DEPTH &&
    !visited.has(currentParentCommentId)
  ) {
    visited.add(currentParentCommentId)
    const [parentComment] = await repository.findParent(currentParentCommentId)

    if (!parentComment?.id) {
      break
    }

    const { authorUsername, authorLabel } = getCommentAuthorInfo(
      parentComment.CommentAuthor
    )

    parentComments.unshift({
      id: parentComment.id,
      text: parentComment.text || '',
      authorUsername,
      authorLabel,
    })

    currentParentCommentId = parentComment.ParentComment?.id || null
  }

  return parentComments
}

export const buildBotInvocationContext = ({
  invocationType,
  server,
  channel,
  discussion,
  comment,
  parentComments = [],
}: {
  invocationType: string
  server?: BotServerSnapshot | null
  channel: BotChannelSnapshot
  discussion?: BotDiscussionSnapshot | null
  comment?: BotCommentSnapshot | null
  parentComments?: BotThreadCommentContext[]
}): BotInvocationContext => {
  const { authorUsername, authorLabel } = getCommentAuthorInfo(
    comment?.CommentAuthor
  )

  return {
    invocationType,
    server: {
      rules: normalizeRules(server?.rules),
    },
    channel: {
      uniqueName: channel.uniqueName || '',
      displayName: channel.displayName || channel.uniqueName || '',
      description: channel.description || null,
      rules: normalizeRules(channel.rules),
    },
    discussion: discussion?.id
      ? {
          id: discussion.id,
          title: discussion.title || 'discussion',
          body: discussion.body || '',
        }
      : null,
    comment: comment?.id
      ? {
          id: comment.id,
          text: comment.text || '',
          authorUsername,
          authorLabel,
          parentCommentId: comment.ParentComment?.id || null,
        }
      : null,
    thread: {
      parentComments,
      rootCommentId: parentComments[0]?.id || null,
    },
  }
}
