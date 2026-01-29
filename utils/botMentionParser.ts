type BotMention = {
  handle: string
  profileId: string | null
  raw: string
}

const BOT_MENTION_REGEX = /(^|\s)(\/bot\/[a-z0-9-]+(?:\:[a-z0-9-]+)?)/g

export const parseBotMentions = (text: string | null | undefined): BotMention[] => {
  if (!text) return []

  const mentions: BotMention[] = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = BOT_MENTION_REGEX.exec(text)) !== null) {
    const raw = match[2]
    if (!raw) continue

    const withoutPrefix = raw.slice('/bot/'.length)
    const [handle, profileId] = withoutPrefix.split(':')
    if (!handle) continue

    const key = `${handle}|${profileId || ''}`
    if (seen.has(key)) continue
    seen.add(key)

    mentions.push({
      handle,
      profileId: profileId || null,
      raw
    })
  }

  return mentions
}
