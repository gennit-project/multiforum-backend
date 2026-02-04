export type UserMention = {
  username: string;
  raw: string;
};

const CODE_FENCE_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_REGEX = /`[^`]*`/g;
const MARKDOWN_LINK_REGEX = /!?\[[^\]]*\]\([^\)]*\)/g;
const AUTO_LINK_REGEX = /<[^>]+>/g;
const URL_REGEX = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

const USER_MENTION_REGEX = /(^|[^A-Za-z0-9_])u\/([A-Za-z0-9_]+)/g;

const stripCodeAndLinks = (text: string): string => {
  return text
    .replace(CODE_FENCE_REGEX, ' ')
    .replace(INLINE_CODE_REGEX, ' ')
    .replace(MARKDOWN_LINK_REGEX, ' ')
    .replace(AUTO_LINK_REGEX, ' ')
    .replace(URL_REGEX, ' ');
};

export const parseUserMentions = (text: string | null | undefined): UserMention[] => {
  if (!text) return [];

  const sanitized = stripCodeAndLinks(text);
  const mentions: UserMention[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = USER_MENTION_REGEX.exec(sanitized)) !== null) {
    const username = match[2];
    if (!username) continue;

    const key = username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    mentions.push({
      username,
      raw: `u/${username}`
    });
  }

  return mentions;
};
