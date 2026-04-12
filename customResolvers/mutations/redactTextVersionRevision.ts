import { GraphQLError } from 'graphql'
import type {
  TextVersion,
  TextVersionModel,
  TextVersionUpdateInput,
  TextVersionWhere
} from '../../ogm_types.js'
import {
  checkChannelModPermissions,
  ModChannelPermission
} from '../../rules/permission/hasChannelModPermission.js'
import { getServerScopedMembership } from '../../rules/permission/getServerScopedMembership.js'
import {
  setUserDataOnContext,
  type UserDataOnContext
} from '../../rules/permission/userDataHelperFunctions.js'

export const REDACTED_REVISION_BODY = '[deleted]'

type Args = {
  textVersionId: string
}

type RevisionType = 'comment' | 'discussion body' | 'wiki'

type RevisionRedactionTarget = {
  targetType: RevisionType | null
  targetId: string | null
  ownerUsername: string | null
  ownerModProfileName: string | null
  channelUniqueName: string | null
}

type CheckChannelModPermissions = typeof checkChannelModPermissions
type GetServerMembership = typeof getServerScopedMembership
type GetUserData = typeof setUserDataOnContext

type Input = {
  TextVersion: TextVersionModel
  driver: any
  revisionType: RevisionType
  checkModPermissions?: CheckChannelModPermissions
  getServerMembership?: GetServerMembership
  getUserData?: GetUserData
}

const revisionPermissionByType: Record<RevisionType, ModChannelPermission> = {
  comment: ModChannelPermission.canEditComments,
  'discussion body': ModChannelPermission.canEditDiscussions,
  wiki: ModChannelPermission.canDeleteWiki
}

export const getRevisionRedactionTarget = async (input: {
  driver: any
  textVersionId: string
}): Promise<RevisionRedactionTarget | null> => {
  const { driver, textVersionId } = input
  const session = driver.session({ defaultAccessMode: 'READ' })

  try {
    const result = await session.run(
      `
      MATCH (version:TextVersion {id: $textVersionId})

      OPTIONAL MATCH (comment:Comment)-[:HAS_VERSION]->(version)
      OPTIONAL MATCH (commentUser:User)-[:AUTHORED_COMMENT]->(comment)
      OPTIONAL MATCH (commentMod:ModerationProfile)-[:AUTHORED_COMMENT]->(comment)
      OPTIONAL MATCH (commentChannel:Channel)-[:HAS_COMMENT]->(comment)
      OPTIONAL MATCH (commentDiscussionChannel:DiscussionChannel)-[:CONTAINS_COMMENT]->(comment)
      OPTIONAL MATCH (commentEvent:Event)-[:HAS_COMMENT]->(comment)
      OPTIONAL MATCH (commentEventChannel:EventChannel)-[:POSTED_IN_CHANNEL]->(commentEvent)
      OPTIONAL MATCH (comment)-[:IS_REPLY_TO]->(parentComment:Comment)
      OPTIONAL MATCH (parentCommentChannel:Channel)-[:HAS_COMMENT]->(parentComment)
      OPTIONAL MATCH (parentCommentDiscussionChannel:DiscussionChannel)-[:CONTAINS_COMMENT]->(parentComment)
      OPTIONAL MATCH (parentCommentEvent:Event)-[:HAS_COMMENT]->(parentComment)
      OPTIONAL MATCH (parentCommentEventChannel:EventChannel)-[:POSTED_IN_CHANNEL]->(parentCommentEvent)

      OPTIONAL MATCH (discussion:Discussion)-[:HAS_BODY_VERSION]->(version)
      OPTIONAL MATCH (discussionAuthor:User)-[:POSTED_DISCUSSION]->(discussion)
      OPTIONAL MATCH (discussionChannel:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(discussion)

      OPTIONAL MATCH (wikiPage:WikiPage)-[:HAS_VERSION]->(version)
      OPTIONAL MATCH (wikiOriginalAuthor:User)-[:AUTHORED_WIKI_PAGE]->(wikiPage)

      RETURN
        CASE
          WHEN comment IS NOT NULL THEN 'comment'
          WHEN discussion IS NOT NULL THEN 'discussion body'
          WHEN wikiPage IS NOT NULL THEN 'wiki'
          ELSE null
        END AS targetType,
        coalesce(comment.id, discussion.id, wikiPage.id) AS targetId,
        coalesce(commentUser.username, discussionAuthor.username, wikiOriginalAuthor.username) AS ownerUsername,
        commentMod.displayName AS ownerModProfileName,
        coalesce(
          commentChannel.uniqueName,
          commentDiscussionChannel.channelUniqueName,
          commentEventChannel.channelUniqueName,
          parentCommentChannel.uniqueName,
          parentCommentDiscussionChannel.channelUniqueName,
          parentCommentEventChannel.channelUniqueName,
          discussionChannel.channelUniqueName,
          wikiPage.channelUniqueName
        ) AS channelUniqueName
      `,
      { textVersionId }
    )

    const record = result.records[0]
    if (!record) {
      return null
    }

    return {
      targetType: record.get('targetType'),
      targetId: record.get('targetId'),
      ownerUsername: record.get('ownerUsername'),
      ownerModProfileName: record.get('ownerModProfileName'),
      channelUniqueName: record.get('channelUniqueName')
    }
  } finally {
    session.close()
  }
}

const getCurrentUser = async (input: {
  context: any
  getUserData: GetUserData
}): Promise<UserDataOnContext> => {
  const { context, getUserData } = input

  if (context.user?.username) {
    return context.user
  }

  context.user = await getUserData({
    context,
    getPermissionInfo: false
  })

  return context.user
}

export const assertCanRedactRevision = async (input: {
  context: any
  target: RevisionRedactionTarget
  revisionType: RevisionType
  checkModPermissions: CheckChannelModPermissions
  getServerMembership: GetServerMembership
  getUserData: GetUserData
}) => {
  const {
    context,
    target,
    revisionType,
    checkModPermissions,
    getServerMembership,
    getUserData
  } = input

  if (target.targetType !== revisionType) {
    throw new GraphQLError(`${revisionType} revision not found`)
  }

  const currentUser = await getCurrentUser({ context, getUserData })
  const currentUsername = currentUser?.username || null
  const currentModProfileName =
    currentUser?.data?.ModerationProfile?.displayName || null

  if (!currentUsername) {
    throw new GraphQLError('User must be logged in')
  }

  if (
    target.ownerUsername === currentUsername ||
    (target.ownerModProfileName &&
      target.ownerModProfileName === currentModProfileName)
  ) {
    return
  }

  const membership = await getServerMembership(context)
  if (membership.isServerAdmin) {
    return
  }

  if (!target.channelUniqueName) {
    throw new GraphQLError('No channel specified for this revision')
  }

  const permissionResult = await checkModPermissions({
    channelConnections: [target.channelUniqueName],
    context,
    permissionCheck: revisionPermissionByType[revisionType]
  })

  if (permissionResult instanceof Error) {
    throw new GraphQLError(permissionResult.message)
  }

  if (permissionResult !== true) {
    throw new GraphQLError('You do not have permission to delete this revision')
  }
}

const redactTextVersionRevision = (input: Input) => {
  const {
    TextVersion,
    driver,
    revisionType,
    checkModPermissions = checkChannelModPermissions,
    getServerMembership = getServerScopedMembership,
    getUserData = setUserDataOnContext
  } = input

  return async (
    parent: any,
    args: Args,
    context: any,
    resolveInfo: any
  ): Promise<TextVersion> => {
    const { textVersionId } = args

    if (!textVersionId) {
      throw new GraphQLError('Revision ID is required')
    }

    const [revision] = await TextVersion.find({
      where: { id: textVersionId },
      selectionSet: `{
        id
        body
        editReason
        createdAt
        updatedAt
        Author {
          username
        }
      }`,
    })

    if (!revision) {
      throw new GraphQLError(`${revisionType} revision not found`)
    }

    const revisionTarget = await getRevisionRedactionTarget({
      driver,
      textVersionId
    })

    if (!revisionTarget) {
      throw new GraphQLError(`${revisionType} revision not found`)
    }

    await assertCanRedactRevision({
      context,
      target: revisionTarget,
      revisionType,
      checkModPermissions,
      getServerMembership,
      getUserData
    })

    if (revision.body === REDACTED_REVISION_BODY) {
      return revision
    }

    const where: TextVersionWhere = {
      id: textVersionId
    }
    const update: TextVersionUpdateInput = {
      body: REDACTED_REVISION_BODY
    }

    const updateResult = await TextVersion.update({
      where,
      update,
      selectionSet: `{
        textVersions {
          id
          body
          editReason
          createdAt
          updatedAt
          Author {
            username
          }
        }
      }`,
    })

    const updatedRevision = updateResult.textVersions[0]
    if (!updatedRevision) {
      throw new GraphQLError(`Error redacting ${revisionType} revision`)
    }

    return updatedRevision
  }
}

export default redactTextVersionRevision
