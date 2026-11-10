import { userSourcePaths } from '../../middleware/userSourcePaths.js';
import type { Album, Channel, Comment, DiscussionChannel } from '../../src/generated/graphql.js';
const channel = userSourcePaths<Channel>()([['Admins'], ['Moderators','BotUser']]);
const album = userSourcePaths<Album>()([['Owner'], ['Images','Uploader']]);
const voters = userSourcePaths<Comment>()([['UpvotedByUsers'], ['SuperUpvotedByUsers']]);
userSourcePaths<DiscussionChannel>()(voters);
// @ts-expect-error schema relationship typo cannot silently disable the adapter
userSourcePaths<Channel>()([['Moderator','BotUser']]);
// @ts-expect-error a moderator profile is not a User source
userSourcePaths<Channel>()([['Moderators']]);
// @ts-expect-error scalar fields cannot be treated as User objects
userSourcePaths<Channel>()([['uniqueName']]);
// @ts-expect-error an image map is not a User source
userSourcePaths<Album>()([['Images']]);
// @ts-expect-error unrestricted JSON does not prove a User source
userSourcePaths<{json:any}>()([['json']]);
// @ts-expect-error an unknown source does not prove a User source
userSourcePaths<{source:unknown}>()([['source']]);
// @ts-expect-error never/null-only paths cannot prove a User source
userSourcePaths<{missing:null}>()([['missing']]);
void [channel,album,voters];
// @ts-expect-error impossible discriminator cannot prove a User source
userSourcePaths<{source:{__typename:never}}>()([['source']]);
// @ts-expect-error mixed branches need the author-union discriminator adapter
userSourcePaths<{source:{__typename:'User'|'ModerationProfile'}}>()([['source']]);
userSourcePaths<Channel>()([['RelatedChannels','RelatedChannels','Admins']]);
// @ts-expect-error nested channels do not turn moderator profiles into Users
userSourcePaths<Channel>()([['RelatedChannels','Moderators']]);
// @ts-expect-error recursive traversal must use the declared Channel edge
userSourcePaths<Channel>()([['RelatedChannel','Admins']]);
