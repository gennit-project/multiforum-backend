import { parseUserMentions } from './userMentionParser.js';

/**
 * Compares previous and next text to find newly added @mentions.
 * Returns usernames that appear in nextText but not in previousText.
 * Case-insensitive comparison, but preserves original casing in output.
 */
export const getNewMentionUsernames = (
  previousText: string | null | undefined,
  nextText: string | null | undefined
): string[] => {
  const before = parseUserMentions(previousText || '').map((m) => m.username);
  const after = parseUserMentions(nextText || '').map((m) => m.username);

  if (!after.length) return [];

  const beforeSet = new Set(before.map((u) => u.toLowerCase()));
  const newMentions: string[] = [];

  for (const username of after) {
    const key = username.toLowerCase();
    if (beforeSet.has(key)) continue;
    if (newMentions.some((existing) => existing.toLowerCase() === key))
      continue;
    newMentions.push(username);
  }

  return newMentions;
};
