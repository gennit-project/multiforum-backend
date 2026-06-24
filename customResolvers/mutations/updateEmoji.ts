type UpdateEmojiInput = { 
  emojiLabel: string;
  unicode: string; 
  username: string ;
}

type RemoveEmojiInput = {
  emojiLabel: string;
  username: string;
}

type EmojiData = Record<string, Record<string, string[]>>;

export const updateEmoji = (emojiJSON: string, input: UpdateEmojiInput) => {
  const { emojiLabel, unicode, username } = input;
  let emoji: EmojiData = {};

  // Parse the existing emoji JSON
  if (emojiJSON) {
    emoji = JSON.parse(emojiJSON);
  }

  // Add emoji label, unicode and username if not exist
  if (!emoji[emojiLabel]) {
    emoji[emojiLabel] = {};
  }
  if (!emoji[emojiLabel][unicode]) {
    emoji[emojiLabel][unicode] = [];
  }
  if (!emoji[emojiLabel][unicode].includes(username)) {
    emoji[emojiLabel][unicode].push(username);
  }

  // Convert updated emoji back to JSON
  return JSON.stringify(emoji);
};

export const removeEmoji = (emojiJSON: string, input: RemoveEmojiInput) => {
  const { emojiLabel, username } = input;
  let emoji: EmojiData = {};

  if (emojiJSON) {
    emoji = JSON.parse(emojiJSON);
  }

  if (emoji[emojiLabel]) {
    for (const unicode in emoji[emojiLabel]) {
      const userIndex = emoji[emojiLabel][unicode].indexOf(username);

      if (userIndex > -1) {
        emoji[emojiLabel][unicode].splice(userIndex, 1);

        if (emoji[emojiLabel][unicode].length === 0) {
          delete emoji[emojiLabel][unicode];
        }
      }
    }

    if (Object.keys(emoji[emojiLabel]).length === 0) {
      delete emoji[emojiLabel];
    }
  }

  return JSON.stringify(emoji);
};

