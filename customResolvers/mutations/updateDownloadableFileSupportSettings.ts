import { GraphQLError } from 'graphql'
import {
  checkChannelModPermissions,
  ModChannelPermission
} from '../../rules/permission/hasChannelModPermission.js'
import { getServerScopedMembership } from '../../rules/permission/getServerScopedMembership.js'
import {
  setUserDataOnContext,
  type UserDataOnContext
} from '../../rules/permission/userDataHelperFunctions.js'

type SupportSettingsInput = {
  attributionOverride?: string | null
  supportPatreonUrl?: string | null
  supportBuyMeACoffeeUrl?: string | null
  supportKoFiUrl?: string | null
  supportPayPalMeUrl?: string | null
}

type Args = {
  downloadableFileId: string
  discussionId: string
  input: SupportSettingsInput
}

type DownloadableFileSupportTarget = {
  authorUsername: string | null
  channelUniqueNames: string[]
}

type CheckChannelModPermissions = typeof checkChannelModPermissions
type GetServerMembership = typeof getServerScopedMembership
type GetUserData = typeof setUserDataOnContext

type Input = {
  driver: any
  checkModPermissions?: CheckChannelModPermissions
  getServerMembership?: GetServerMembership
  getUserData?: GetUserData
}

const supportUrlRules: Record<keyof Omit<SupportSettingsInput, 'attributionOverride'>, RegExp> = {
  supportPatreonUrl: /^https:\/\/(www\.)?patreon\.com\/.+/i,
  supportBuyMeACoffeeUrl: /^https:\/\/(www\.)?buymeacoffee\.com\/.+/i,
  supportKoFiUrl: /^https:\/\/(www\.)?ko-fi\.com\/.+/i,
  supportPayPalMeUrl: /^https:\/\/(www\.)?paypal\.me\/.+/i
}

const supportUrlLabels: Record<keyof typeof supportUrlRules, string> = {
  supportPatreonUrl: 'Patreon',
  supportBuyMeACoffeeUrl: 'Buy Me a Coffee',
  supportKoFiUrl: 'Ko-fi',
  supportPayPalMeUrl: 'PayPal.me'
}

export const validateSupportSettings = (input: SupportSettingsInput) => {
  for (const [field, pattern] of Object.entries(supportUrlRules) as Array<[keyof typeof supportUrlRules, RegExp]>) {
    const value = input[field]
    if (value && !pattern.test(value)) {
      throw new GraphQLError(`${supportUrlLabels[field]} URL must use the expected support site`)
    }
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

const getSupportTarget = async (input: {
  driver: any
  downloadableFileId: string
  discussionId: string
}): Promise<DownloadableFileSupportTarget | null> => {
  const { driver, downloadableFileId, discussionId } = input
  const session = driver.session({ defaultAccessMode: 'READ' })

  try {
    const result = await session.run(
      `
      MATCH (discussion:Discussion {id: $discussionId})-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile {id: $downloadableFileId})
      OPTIONAL MATCH (author:User)-[:POSTED_DISCUSSION]->(discussion)
      OPTIONAL MATCH (discussionChannel:DiscussionChannel)-[:POSTED_IN_CHANNEL]->(discussion)
      RETURN author.username AS authorUsername, collect(discussionChannel.channelUniqueName) AS channelUniqueNames
      `,
      {
        downloadableFileId,
        discussionId
      }
    )

    const record = result.records[0]
    if (!record) {
      return null
    }

    return {
      authorUsername: record.get('authorUsername'),
      channelUniqueNames: record.get('channelUniqueNames') || []
    }
  } finally {
    session.close()
  }
}

const assertCanUpdateSupportSettings = async (input: {
  context: any
  target: DownloadableFileSupportTarget
  checkModPermissions: CheckChannelModPermissions
  getServerMembership: GetServerMembership
  getUserData: GetUserData
}) => {
  const {
    context,
    target,
    checkModPermissions,
    getServerMembership,
    getUserData
  } = input

  const currentUser = await getCurrentUser({ context, getUserData })
  const currentUsername = currentUser?.username || null

  if (!currentUsername) {
    throw new GraphQLError('User must be logged in')
  }

  if (target.authorUsername === currentUsername) {
    return
  }

  const membership = await getServerMembership(context)
  if (membership.isServerAdmin) {
    return
  }

  if (target.channelUniqueNames.length === 0) {
    throw new GraphQLError('No channel specified for this download')
  }

  const permissionResult = await checkModPermissions({
    channelConnections: target.channelUniqueNames,
    context,
    permissionCheck: ModChannelPermission.canEditDiscussions
  })

  if (permissionResult instanceof Error) {
    throw new GraphQLError(permissionResult.message)
  }

  if (permissionResult !== true) {
    throw new GraphQLError('You do not have permission to update this download')
  }
}

const updateDownloadableFileSupportSettings = ({
  driver,
  checkModPermissions = checkChannelModPermissions,
  getServerMembership = getServerScopedMembership,
  getUserData = setUserDataOnContext
}: Input) => {
  return async (_parent: any, args: Args, context: any) => {
    const { downloadableFileId, discussionId, input } = args

    if (!downloadableFileId) {
      throw new GraphQLError('Downloadable file ID is required')
    }

    if (!discussionId) {
      throw new GraphQLError('Discussion ID is required')
    }

    validateSupportSettings(input || {})

    const target = await getSupportTarget({
      driver,
      downloadableFileId,
      discussionId
    })

    if (!target) {
      throw new GraphQLError('Downloadable file not found for this discussion')
    }

    await assertCanUpdateSupportSettings({
      context,
      target,
      checkModPermissions,
      getServerMembership,
      getUserData
    })

    const session = driver.session({ defaultAccessMode: 'WRITE' })

    try {
      const result = await session.run(
        `
        MATCH (discussion:Discussion {id: $discussionId})-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile {id: $downloadableFileId})
        SET
          file.attributionOverride = $attributionOverride,
          file.supportPatreonUrl = $supportPatreonUrl,
          file.supportBuyMeACoffeeUrl = $supportBuyMeACoffeeUrl,
          file.supportKoFiUrl = $supportKoFiUrl,
          file.supportPayPalMeUrl = $supportPayPalMeUrl
        RETURN count(file) AS updated
        `,
        {
          downloadableFileId,
          discussionId,
          attributionOverride: input.attributionOverride || null,
          supportPatreonUrl: input.supportPatreonUrl || null,
          supportBuyMeACoffeeUrl: input.supportBuyMeACoffeeUrl || null,
          supportKoFiUrl: input.supportKoFiUrl || null,
          supportPayPalMeUrl: input.supportPayPalMeUrl || null
        }
      )

      const updated = result.records[0]?.get('updated')?.toNumber?.() ?? result.records[0]?.get('updated') ?? 0

      if (updated < 1) {
        throw new GraphQLError('Downloadable file not found for this discussion')
      }

      return true
    } finally {
      session.close()
    }
  }
}

export default updateDownloadableFileSupportSettings
