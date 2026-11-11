// Compile-only negative fixtures, enforced by tsc rather than runtime coverage.
import type { ReactionMutationResolvers } from "../../customResolvers/contracts/reactions.js";
import type { CommentEmojiState, DiscussionChannelEmojiState } from "../../services/persistence/contentValidationRepository.js";

type Add = ReactionMutationResolvers["addEmojiToComment"];
const valid: Add = async (_parent, args) => ({ id: args.commentId, emoji: "{}" });
const absent: Add = () => null;
// @ts-expect-error selected id must be a string
const badId: Add = () => ({ id: 42, emoji: "{}" });
// @ts-expect-error selected emoji property must be present (its JSON value is unrestricted)
const missingEmoji: Add = () => ({ id: "c" });
// @ts-expect-error generated required argument types cannot be narrowed to numbers
const badArgs: Add = (_parent, args: { commentId: number }) => ({ id: String(args.commentId), emoji: "{}" });
const comment: CommentEmojiState = { id: "c", emoji: null, archived: null, Channel: null, DiscussionChannel: null };
// @ts-expect-error full Comment fields are not fetched
comment.text;
// @ts-expect-error selected nullable fields are required properties
const missingChannel: CommentEmojiState = { id: "c", emoji: "{}", archived: null, DiscussionChannel: null };
// @ts-expect-error discussion projection requires channelUniqueName and locked
const wrongTarget: DiscussionChannelEmojiState = comment;
// @ts-expect-error boolean selections cannot be strings
const badFlag: CommentEmojiState = { ...comment, archived: "false" };
// @ts-expect-error nested selected channel name is non-null
const badChannel: CommentEmojiState = { ...comment, Channel: { uniqueName: null, emojiEnabled: null } };
void [valid, absent, badId, missingEmoji, badArgs, missingChannel, wrongTarget, badFlag, badChannel];
