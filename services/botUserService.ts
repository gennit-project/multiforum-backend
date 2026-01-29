import type { ChannelModel, CommentModel, UserModel } from '../ogm_types.js'

type BotProfile = {
  id: string
  label?: string | null
}

const BOT_PREFIX = 'bot'
const SAFE_ID_REGEX = /^[a-z0-9-]+$/

const normalizeId = (value: string) => value.trim().toLowerCase()

const ensureSafeId = (value: string, label: string) => {
  if (!SAFE_ID_REGEX.test(value)) {
    throw new Error(`${label} must match ${SAFE_ID_REGEX.toString()}`)
  }
}

const buildBotUsername = (channelUniqueName: string, botName: string, profileId?: string | null) => {
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

const buildBotDisplayName = (botName: string, profile?: BotProfile | null) => {
  if (!profile?.id) {
    return botName
  }
  return profile.label ? `${botName} (${profile.label})` : `${botName} (${profile.id})`
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
  const displayName = buildBotDisplayName(botName, profileId ? { id: profileId, label: profileLabel } : null)

  const existingUsers = await User.find({
    where: { username },
    selectionSet: `{
      id
      username
      isBot
      botProfileId
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
  } else if (!user.isBot || user.botProfileId !== (profileId || null)) {
    await User.update({
      where: { id: user.id },
      update: {
        isBot: true,
        botProfileId: profileId || null,
        displayName
      }
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

  await ensureBotUserForChannel({
    User,
    Channel,
    channelUniqueName,
    botName,
    profileId: null,
    profileLabel: null
  })

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

export const getProfilesFromSettings = (settingsJson: any): BotProfile[] => {
  const fromServer = settingsJson?.server?.profiles
  const fromRoot = settingsJson?.profiles
  const profiles = Array.isArray(fromServer) ? fromServer : Array.isArray(fromRoot) ? fromRoot : []

  return profiles
    .filter((profile: any) => profile && typeof profile.id === 'string')
    .map((profile: any) => ({
      id: String(profile.id).trim(),
      label: profile.label ? String(profile.label) : null
    }))
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

  const commentInput: Record<string, any> = {
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
