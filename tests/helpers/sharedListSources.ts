import type { Album, Channel, Comment, DiscussionChannel } from '../../src/generated/graphql.js';

type ListKeys<T> = {[Key in keyof T]-?: 0 extends (1 & T[Key]) ? never : [NonNullable<T[Key]>] extends [never] ? never : NonNullable<T[Key]> extends readonly unknown[] ? Key : never}[keyof T];
export type GeneratedListSource =
 | {parent:'Channel';root:'channels';key:'uniqueName';field:ListKeys<Channel>}
 | {parent:'Album';root:'albums';key:'id';field:ListKeys<Album>}
 | {parent:'Comment';root:'comments';key:'id';field:ListKeys<Comment>}
 | {parent:'DiscussionChannel';root:'discussionChannels';key:'id';field:ListKeys<DiscussionChannel>};

/** Generated root probes for every current opaque fallback registration.
 * This is an executable coverage manifest, not a full item-value contract.
 */
export const sharedListSources = [
 {parent:'Channel',root:'channels',key:'uniqueName',field:'Admins'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'Bots'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'Comments'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'DiscussionChannels'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'EventChannels'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'InCollections'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'Moderators'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'PendingModInvites'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'PendingOwnerInvites'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'PinnedDiscussionChannels'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'PinnedWikiPages'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'RelatedChannels'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'SuspendedMods'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'SuspendedUsers'},
 {parent:'Channel',root:'channels',key:'uniqueName',field:'Tags'},
 {parent:'Album',root:'albums',key:'id',field:'Images'},
 {parent:'Comment',root:'comments',key:'id',field:'SuperUpvotedByUsers'},
 {parent:'DiscussionChannel',root:'discussionChannels',key:'id',field:'SuperUpvotedByUsers'},
] as const satisfies readonly GeneratedListSource[];
