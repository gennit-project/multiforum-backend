import type {CommentEmojiState,ValidationDiscussionChannels,ValidationExistingFile} from '../../customResolvers/contracts/contentValidationProjections.js';
// @ts-expect-error selected discussion relationships are required, not an optional catch-all
const missing:ValidationDiscussionChannels={};
// @ts-expect-error channel identity must be selected and non-null
const missingIdentity:ValidationDiscussionChannels={DiscussionChannels:[{}]};
declare const comment:CommentEmojiState;
// @ts-expect-error the selected channel link remains nullable
const enabled:boolean=comment.Channel.emojiEnabled;
// @ts-expect-error the query does not fetch complete comment content
void comment.text;
declare const file:ValidationExistingFile;
// @ts-expect-error file validation does not fetch upload identity
void file.uploadedByUsername;
void [missing,missingIdentity,enabled];
