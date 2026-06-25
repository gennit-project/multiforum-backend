import assert from "node:assert/strict";
import test from "node:test";
import addEmojiToCommentResolver from "./addEmojiToComment.js";
import addEmojiToDiscussionChannelResolver from "./addEmojiToDiscussionChannel.js";
import removeEmojiFromCommentResolver from "./removeEmojiFromComment.js";
import removeEmojiFromDiscussionChannelResolver from "./removeEmojiFromDiscussionChannel.js";
import { ModelStub, withMutedConsoleError } from "../../tests/testUtils.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

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

const createCommentWith = (overrides: Record<string, unknown>) =>
  new ModelStub(() => [
    {
      id: "comment-1",
      emoji: "",
      archived: false,
      Channel: { uniqueName: "cats", emojiEnabled: true },
      DiscussionChannel: {
        channelUniqueName: "cats",
        locked: false,
        archived: false,
        Channel: { uniqueName: "cats", emojiEnabled: true },
      },
      ...overrides,
    },
  ]);

const createDiscussionChannelWith = (overrides: Record<string, unknown>) =>
  new ModelStub(() => [
    {
      id: "discussion-channel-1",
      emoji: "",
      channelUniqueName: "cats",
      locked: false,
      archived: false,
      Channel: { uniqueName: "cats", emojiEnabled: true },
      ...overrides,
    },
  ]);

test("addEmojiToComment rejects disabled emoji channels", async () => {
  const Comment = createDisabledComment();
  const resolver = addEmojiToCommentResolver({ Comment: Comment as any });

  await assert.rejects(
    withMutedConsoleError(() =>
      resolver(null, { ...emojiArgs, commentId: "comment-1" }, {} as unknown as GraphQLContext, null as unknown as GraphQLResolveInfo)
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
        {} as unknown as GraphQLContext,
        null as unknown as GraphQLResolveInfo
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
        {} as unknown as GraphQLContext,
        null as unknown as GraphQLResolveInfo
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
        {} as unknown as GraphQLContext,
        null as unknown as GraphQLResolveInfo
      )
    ),
    /Emoji reactions are disabled in channel 'cats'/
  );
});

// Locked/archived content is frozen for reactions (item: "when a comment or
// discussion is locked, it does not allow emojis").

test("addEmojiToComment rejects when the comment is archived", async () => {
  const Comment = createCommentWith({ archived: true });
  const resolver = addEmojiToCommentResolver({ Comment: Comment as any });

  await assert.rejects(
    withMutedConsoleError(() =>
      resolver(null, { ...emojiArgs, commentId: "comment-1" }, {} as unknown as GraphQLContext, null as unknown as GraphQLResolveInfo)
    ),
    /this comment is archived/
  );
});

test("addEmojiToComment rejects when the discussion is locked", async () => {
  const Comment = createCommentWith({
    DiscussionChannel: {
      channelUniqueName: "cats",
      locked: true,
      archived: false,
      Channel: { uniqueName: "cats", emojiEnabled: true },
    },
  });
  const resolver = addEmojiToCommentResolver({ Comment: Comment as any });

  await assert.rejects(
    withMutedConsoleError(() =>
      resolver(null, { ...emojiArgs, commentId: "comment-1" }, {} as unknown as GraphQLContext, null as unknown as GraphQLResolveInfo)
    ),
    /this discussion is locked/
  );
});

test("addEmojiToDiscussionChannel rejects when locked", async () => {
  const DiscussionChannel = createDiscussionChannelWith({ locked: true });
  const resolver = addEmojiToDiscussionChannelResolver({
    DiscussionChannel: DiscussionChannel as any,
  });

  await assert.rejects(
    withMutedConsoleError(() =>
      resolver(
        null,
        { ...emojiArgs, discussionChannelId: "discussion-channel-1" },
        {} as unknown as GraphQLContext,
        null as unknown as GraphQLResolveInfo
      )
    ),
    /this discussion is locked/
  );
});

test("addEmojiToDiscussionChannel rejects when archived", async () => {
  const DiscussionChannel = createDiscussionChannelWith({ archived: true });
  const resolver = addEmojiToDiscussionChannelResolver({
    DiscussionChannel: DiscussionChannel as any,
  });

  await assert.rejects(
    withMutedConsoleError(() =>
      resolver(
        null,
        { ...emojiArgs, discussionChannelId: "discussion-channel-1" },
        {} as unknown as GraphQLContext,
        null as unknown as GraphQLResolveInfo
      )
    ),
    /this discussion is archived/
  );
});
