import type { ChannelModel, CommentCreateInput, CommentModel, UserModel } from '../ogm_types.js'

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
  User: UserModel
  Channel: ChannelModel
  channelUniqueName: string
  botName: string
  profileId?: string | null
  profileLabel?: string | null
}) => {
  const { User, Channel, channelUniqueName, botName, profileId, profileLabel } = input

  const username = buildBotUsername(channelUniqueName, botName, profileId)
  const displayName = buildBotDisplayName(profileId ? { id: profileId, label: profileLabel } : null)

  const existingUsers = await User.find({
    where: { username },
    selectionSet: `{
      username
      isBot
      botProfileId
      isDeprecated
      deprecatedReason
    }`
  })

  let user = existingUsers[0] || null

  if (!user) {
    const created = await User.create({
      input: [
        ({
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
        } as any)
      ]
    })
    user = created.users[0]
  } else {
    // Check if bot needs updates: profile mismatch, or needs to be reactivated from deprecated state
    const needsUpdate = !user.isBot ||
      user.botProfileId !== (profileId || null) ||
      user.isDeprecated ||
      user.deprecatedReason

    if (needsUpdate) {
      await User.update({
        where: { username: user.username },
        update: {
          isBot: true,
          botProfileId: profileId || null,
          displayName,
          isDeprecated: false,
          deprecatedReason: null
        }
      })
    }
  }

  const channelResult = await Channel.find({
    where: { uniqueName: channelUniqueName },
    selectionSet: `{
      uniqueName
      Bots {
        username
      }
    }`
  })

  const channel = channelResult[0]
  if (!channel) {
    throw new Error(`Channel "${channelUniqueName}" not found`)
  }

  const existingBotUsernames = new Set((channel.Bots || []).map((bot: any) => bot.username))

  if (!existingBotUsernames.has(username)) {
    await Channel.update({
      where: { uniqueName: channelUniqueName },
      connect: {
        Bots: [{ where: { node: { username } } }]
      }
    })
  }

  return user
}

export const ensureBotUsersForChannelProfiles = async (input: {
  User: UserModel
  Channel: ChannelModel
  channelUniqueName: string
  botName: string
  profiles: BotProfile[]
}) => {
  const { User, Channel, channelUniqueName, botName, profiles } = input

  // Always create the base bot
  await ensureBotUserForChannel({
    User,
    Channel,
    channelUniqueName,
    botName,
    profileId: null,
    profileLabel: null
  })

  // Create profile-specific bots
  for (const profile of profiles) {
    if (!profile?.id) continue
    await ensureBotUserForChannel({
      User,
      Channel,
      channelUniqueName,
      botName,
      profileId: profile.id,
      profileLabel: profile.label || null
    })
  }
}

const parseSettingsJson = (settingsJson: any) => {
  if (!settingsJson || typeof settingsJson !== 'string') {
    return settingsJson
  }
  try {
    return JSON.parse(settingsJson)
  } catch {
    return null
  }
}

const parseProfilesJson = (value: any) => {
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

export const getProfilesFromSettings = (settingsJson: any): BotProfile[] => {
  const parsed = parseSettingsJson(settingsJson)
  const fromServer = parsed?.server?.profiles
  const fromRoot = parsed?.profiles
  const profiles = Array.isArray(fromServer) ? fromServer : Array.isArray(fromRoot) ? fromRoot : []
  const profilesJson =
    parseProfilesJson(parsed?.profilesJson) ||
    parseProfilesJson(parsed?.server?.profilesJson)
  const resolvedProfiles = profiles.length > 0 ? profiles : profilesJson

  return (resolvedProfiles || [])
    .filter((profile: any) => profile && typeof profile.id === 'string')
    .map((profile: any) => ({
      id: String(profile.id).trim(),
      label: profile.label ? String(profile.label) : null
    }))
}

export const getBotNameFromSettings = (settingsJson: any) => {
  const parsed = parseSettingsJson(settingsJson)
  const fromRoot = typeof parsed?.botName === 'string' ? parsed.botName : null
  const fromServer = typeof parsed?.server?.botName === 'string' ? parsed.server.botName : null
  const botName = (fromRoot || fromServer || '').trim()
  return botName.length > 0 ? botName : null
}

export const syncBotUsersForChannelProfiles = async (input: {
  User: UserModel
  Channel: ChannelModel
  channelUniqueName: string
  botName: string
  profiles: BotProfile[]
}) => {
  const { User, Channel, channelUniqueName, botName, profiles } = input

  const baseUsername = buildBotUsername(channelUniqueName, botName, null)
  const desiredUsernames = new Set(
    [
      baseUsername,
      ...(profiles || [])
        .filter((profile) => profile?.id)
        .map((profile) => buildBotUsername(channelUniqueName, botName, profile.id))
    ]
  )

  // Always create the base bot
  await ensureBotUserForChannel({
    User,
    Channel,
    channelUniqueName,
    botName,
    profileId: null,
    profileLabel: null
  })

  // Create profile-specific bots
  for (const profile of profiles || []) {
    if (!profile?.id) continue
    await ensureBotUserForChannel({
      User,
      Channel,
      channelUniqueName,
      botName,
      profileId: profile.id,
      profileLabel: profile.label || null
    })
  }

  const channelResult = await Channel.find({
    where: { uniqueName: channelUniqueName },
    selectionSet: `{
      uniqueName
      Bots {
        username
      }
    }`
  })

  const channel = channelResult[0]
  if (!channel) {
    throw new Error(`Channel "${channelUniqueName}" not found`)
  }

  const normalizedChannel = normalizeId(channelUniqueName)
  const normalizedBot = normalizeId(botName)
  const botPrefix = `${BOT_PREFIX}-${normalizedChannel}-${normalizedBot}`

  const botsToDisconnect = (channel.Bots || [])
    .map((bot: any) => bot.username)
    .filter((username: string) => username.startsWith(botPrefix))
    .filter((username: string) => !desiredUsernames.has(username))

  if (botsToDisconnect.length > 0) {
    await Channel.update({
      where: { uniqueName: channelUniqueName },
      disconnect: {
        Bots: botsToDisconnect.map((username: string) => ({
          where: { node: { username } }
        }))
      }
    })
  }
}

export const createBotComment = async (input: {
  Comment: CommentModel
  User: UserModel
  Channel: ChannelModel
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
    Comment,
    User,
    Channel,
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

  const botUser = await ensureBotUserForChannel({
    User,
    Channel,
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

  const created = await Comment.create({
    input: [commentInput]
  })

  return created.comments[0]
}
