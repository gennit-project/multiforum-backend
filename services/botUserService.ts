import { createBotCommentRepository, type BotCommentRepository } from './persistence/botCommentRepository.js'
import { createBotIdentityRepository, type BotIdentityRepository } from './persistence/botIdentityRepository.js'
import type { CommentCreateInput, UserCreateInput } from '../ogm_types.js'
import type { Driver } from 'neo4j-driver'
import { assertReplyRelationship } from './replyAncestry.js'

type BotProfile = {
  id: string
  label?: string | null
}

const BOT_PREFIX = 'bot'
const SAFE_ID_REGEX = /^[a-z0-9_-]+$/

const normalizeId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')

const ensureSafeId = (value: string, label: string) => {
  if (!SAFE_ID_REGEX.test(value)) {
    throw new Error(`${label} must match ${SAFE_ID_REGEX.toString()}`)
  }
}

export const buildBotUsername = (channelUniqueName: string, botName: string, profileId?: string | null) => {
  const normalizedChannel = normalizeId(channelUniqueName)
  const normalizedBot = normalizeId(botName)

  ensureSafeId(normalizedChannel, 'channelUniqueName')
  ensureSafeId(normalizedBot, 'botName')

  if (profileId) {
    const normalizedProfile = normalizeId(profileId)
    ensureSafeId(normalizedProfile, 'profileId')
    return `${BOT_PREFIX}-${normalizedChannel}-${normalizedBot}-${normalizedProfile}`
  }

  return `${BOT_PREFIX}-${normalizedChannel}-${normalizedBot}`
}

// Returns just the profile label as the display name, or null if no label.
// The display name is separate from the username - they are different concepts.
const buildBotDisplayName = (profile?: BotProfile | null): string | null => {
  if (!profile?.label) {
    return null
  }
  return profile.label
}

export const ensureBotUserForChannel = async (input: {
  driver?: Driver
  repository?: BotIdentityRepository
  channelUniqueName: string
  botName: string
  profileId?: string | null
  profileLabel?: string | null
}) => {
  const { driver, repository: injectedRepository, channelUniqueName, botName, profileId, profileLabel } = input

  const username = buildBotUsername(channelUniqueName, botName, profileId)
  const displayName = buildBotDisplayName(profileId ? { id: profileId, label: profileLabel } : null)

  const repository = injectedRepository ?? createBotIdentityRepository(driver as Driver)
  const existingUsers = await repository.findIdentity(username)

  let user = existingUsers[0] || null

  if (!user) {
    const created = await repository.createIdentity({
          username,
          displayName,
          isBot: true,
          botProfileId: profileId || null,
          ModerationProfile: {
            create: {
              node: {
                displayName: username
              }
            }
          }
        } as unknown as UserCreateInput)
    user = created.users[0]
  } else {
    // Check if bot needs updates: profile mismatch, or needs to be reactivated from deprecated state
    const needsUpdate = !user.isBot ||
      user.botProfileId !== (profileId || null) ||
      user.isDeprecated ||
      user.deprecatedReason

    if (needsUpdate) {
      await repository.reactivateIdentity(user.username, {
          isBot: { set: true },
          botProfileId: { set: profileId || null },
          displayName: { set: displayName },
          isDeprecated: { set: false },
          deprecatedReason: null
      })
    }
  }

  const channelResult = await repository.findChannelBots(channelUniqueName)

  const channel = channelResult[0]
  if (!channel) {
    throw new Error(`Channel "${channelUniqueName}" not found`)
  }

  const existingBotUsernames = new Set((channel.Bots || []).map((bot: { username: string }) => bot.username))

  if (!existingBotUsernames.has(username)) {
    await repository.connectBot(channelUniqueName, username)
  }

  return user
}

type ParsedSettings = Record<string, any> | null

const parseSettingsJson = (settingsJson: unknown): ParsedSettings => {
  if (!settingsJson || typeof settingsJson !== 'string') {
    return (settingsJson as ParsedSettings) ?? null
  }
  try {
    return JSON.parse(settingsJson)
  } catch {
    return null
  }
}

const parseProfilesJson = (value: unknown): unknown[] | null => {
  if (!value || typeof value !== 'string') {
    return null
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const getProfilesFromSettings = (settingsJson: unknown): BotProfile[] => {
  const parsed = parseSettingsJson(settingsJson)
  const fromServer = parsed?.server?.profiles
  const fromRoot = parsed?.profiles
  const profiles = Array.isArray(fromServer) ? fromServer : Array.isArray(fromRoot) ? fromRoot : []
  const profilesJson =
    parseProfilesJson(parsed?.profilesJson) ||
    parseProfilesJson(parsed?.server?.profilesJson)
  const resolvedProfiles = profiles.length > 0 ? profiles : profilesJson

  return (resolvedProfiles || [])
    .filter((profile: { id?: unknown; label?: unknown }) => profile && typeof profile.id === 'string')
    .map((profile: { id: unknown; label?: unknown }) => ({
      id: String(profile.id).trim(),
      label: profile.label ? String(profile.label) : null
    }))
}

export const getBotNameFromSettings = (settingsJson: unknown) => {
  const parsed = parseSettingsJson(settingsJson)
  const fromRoot = typeof parsed?.botName === 'string' ? parsed.botName : null
  const fromServer = typeof parsed?.server?.botName === 'string' ? parsed.server.botName : null
  const botName = (fromRoot || fromServer || '').trim()
  return botName.length > 0 ? botName : null
}

export const syncBotUsersForChannelProfiles = async (input: {
  driver?: Driver
  repository?: BotIdentityRepository
  channelUniqueName: string
  botName: string
  profiles: BotProfile[]
}) => {
  const { driver, repository: injectedRepository, channelUniqueName, botName, profiles } = input
  const repository = injectedRepository ?? createBotIdentityRepository(driver as Driver)

  // Calculate desired usernames for profile-specific bots only (no base bot)
  const desiredUsernames = new Set(
    (profiles || [])
      .filter((profile) => profile?.id)
      .map((profile) => buildBotUsername(channelUniqueName, botName, profile.id))
  )

  // Create profile-specific bots only (no base bot)
  for (const profile of profiles || []) {
    if (!profile?.id) continue
    await ensureBotUserForChannel({
      driver,
      repository,
      channelUniqueName,
      botName,
      profileId: profile.id,
      profileLabel: profile.label || null
    })
  }

  const channelResult = await repository.findChannelBots(channelUniqueName)

  const channel = channelResult[0]
  if (!channel) {
    throw new Error(`Channel "${channelUniqueName}" not found`)
  }

  const normalizedChannel = normalizeId(channelUniqueName)
  const normalizedBot = normalizeId(botName)
  const botPrefix = `${BOT_PREFIX}-${normalizedChannel}-${normalizedBot}`

  const botsToDisconnect = (channel.Bots || [])
    .map((bot: { username: string }) => bot.username)
    .filter((username: string) => username.startsWith(botPrefix))
    .filter((username: string) => !desiredUsernames.has(username))

  if (botsToDisconnect.length > 0) {
    await repository.disconnectBots(channelUniqueName, botsToDisconnect)
  }
}

export const createBotComment = async (input: {
  commentRepository?: BotCommentRepository
  driver?: Driver
  repository?: BotIdentityRepository
  channelUniqueName: string
  text: string
  botName: string
  profileId?: string | null
  profileLabel?: string | null
  parentCommentId?: string | null
  discussionChannelId?: string | null
  eventId?: string | null
}) => {
  const {
    commentRepository,
    repository,
    driver,
    channelUniqueName,
    text,
    botName,
    profileId,
    profileLabel,
    parentCommentId,
    discussionChannelId,
    eventId
  } = input

  if (!text) {
    throw new Error('Comment text is required')
  }

  if (parentCommentId) {
    if (!driver) {
      throw new Error('Database driver is required to validate reply ancestry')
    }
    await assertReplyRelationship({
      driver,
      parentCommentId,
    })
  }

  const botUser = await ensureBotUserForChannel({
    driver,
    repository,
    channelUniqueName,
    botName,
    profileId,
    profileLabel
  })

  const commentInput: CommentCreateInput = {
    text,
    isRootComment: false,
    isFeedbackComment: false,
    CommentAuthor: {
      User: {
        connect: {
          where: {
            node: {
              username: botUser.username
            }
          }
        }
      }
    },
    Channel: {
      connect: {
        where: {
          node: {
            uniqueName: channelUniqueName
          }
        }
      }
    }
  }

  if (parentCommentId) {
    commentInput.ParentComment = {
      connect: {
        where: {
          node: {
            id: parentCommentId
          }
        }
      }
    }
  }

  if (discussionChannelId) {
    commentInput.DiscussionChannel = {
      connect: {
        where: {
          node: {
            id: discussionChannelId
          }
        }
      }
    }
  }

  if (eventId) {
    commentInput.Event = {
      connect: {
        where: {
          node: {
            id: eventId
          }
        }
      }
    }
  }

  const created = await (commentRepository ?? createBotCommentRepository(driver as Driver)).createReply(commentInput)

  return created.comments[0]
}
