import assert from "node:assert/strict";
import test from "node:test";
import addEmojiToCommentResolver from "./addEmojiToComment.js";
import addEmojiToDiscussionChannelResolver from "./addEmojiToDiscussionChannel.js";
import removeEmojiFromCommentResolver from "./removeEmojiFromComment.js";
import removeEmojiFromDiscussionChannelResolver from "./removeEmojiFromDiscussionChannel.js";
import { ModelStub, withMutedConsoleError } from "../../tests/testUtils.js";

const emojiArgs = {
  emojiLabel: "thumbsup",
  unicode: "👍",
  username: "alice",
};

const createDisabledComment = () =>
  new ModelStub(() => [
    {
      id: "comment-1",
      emoji: "",
      Channel: {
        uniqueName: "cats",
        emojiEnabled: false,
      },
    },
  ]);

const createDisabledDiscussionChannel = () =>
  new ModelStub(() => [
    {
      id: "discussion-channel-1",
      emoji: "",
      channelUniqueName: "cats",
      Channel: {
        uniqueName: "cats",
        emojiEnabled: false,
      },
    },
  ]);

test("addEmojiToComment rejects disabled emoji channels", async () => {
  const Comment = createDisabledComment();
  const resolver = addEmojiToCommentResolver({ Comment: Comment as any });

  await assert.rejects(
    withMutedConsoleError(() =>
      resolver(null, { ...emojiArgs, commentId: "comment-1" }, {}, null)
    ),
    /Emoji reactions are disabled in channel 'cats'/
  );
});

test("removeEmojiFromComment rejects disabled emoji channels", async () => {
  const Comment = createDisabledComment();
  const resolver = removeEmojiFromCommentResolver({ Comment: Comment as any });

  await assert.rejects(
    withMutedConsoleError(() =>
      resolver(
        null,
        {
          commentId: "comment-1",
          emojiLabel: emojiArgs.emojiLabel,
          username: emojiArgs.username,
        },
        {},
        null
      )
    ),
    /Emoji reactions are disabled in channel 'cats'/
  );
});

test("addEmojiToDiscussionChannel rejects disabled emoji channels", async () => {
  const DiscussionChannel = createDisabledDiscussionChannel();
  const resolver = addEmojiToDiscussionChannelResolver({
    DiscussionChannel: DiscussionChannel as any,
  });

  await assert.rejects(
    withMutedConsoleError(() =>
      resolver(
        null,
        {
          ...emojiArgs,
          discussionChannelId: "discussion-channel-1",
        },
        {},
        null
      )
    ),
    /Emoji reactions are disabled in channel 'cats'/
  );
});

test("removeEmojiFromDiscussionChannel rejects disabled emoji channels", async () => {
  const DiscussionChannel = createDisabledDiscussionChannel();
  const resolver = removeEmojiFromDiscussionChannelResolver({
    DiscussionChannel: DiscussionChannel as any,
  });

  await assert.rejects(
    withMutedConsoleError(() =>
      resolver(
        null,
        {
          discussionChannelId: "discussion-channel-1",
          emojiLabel: emojiArgs.emojiLabel,
          username: emojiArgs.username,
        },
        {},
        null
      )
    ),
    /Emoji reactions are disabled in channel 'cats'/
  );
});
