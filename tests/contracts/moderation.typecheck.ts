// Type-only fixture: compile through tsc, never include in runtime coverage.
import type { ModerationMutationResolvers } from "../../customResolvers/contracts/moderation.js";
import type { WikiPinPage, WikiLockPage, WikiLockResult } from "../../services/persistence/wikiActionRepository.js";
import type { StickyCommentResult } from "../../services/persistence/stickyCommentRepository.js";
import type { SoftDeletedComment } from "../../customResolvers/mutations/softDeleteComment.js";
import { lockWikiPage, unlockWikiPage } from "../../customResolvers/mutations/wikiPageLocks.js";
import { pinWikiPageToChannel, unpinWikiPageFromChannel } from "../../customResolvers/mutations/wikiPagePins.js";
import { stickyComment, unstickyComment } from "../../customResolvers/mutations/stickyComment.js";
import { setFeaturedWikiPages } from "../../customResolvers/mutations/setFeaturedWikiPages.js";
import softDeleteComment from "../../customResolvers/mutations/softDeleteComment.js";
const factoryContracts: {
 lockWikiPage: ReturnType<typeof lockWikiPage>;
 unlockWikiPage: ReturnType<typeof unlockWikiPage>;
 pinWikiPageToChannel: ReturnType<typeof pinWikiPageToChannel>;
 unpinWikiPageFromChannel: ReturnType<typeof unpinWikiPageFromChannel>;
 stickyComment: ReturnType<typeof stickyComment>;
 unstickyComment: ReturnType<typeof unstickyComment>;
 setFeaturedWikiPages: ReturnType<typeof setFeaturedWikiPages>;
 softDeleteComment: ReturnType<typeof softDeleteComment>;
} = null!;
const checked: ModerationMutationResolvers = factoryContracts;
// @ts-expect-error wiki lock is non-null even when the target is missing
const nullable: ModerationMutationResolvers["lockWikiPage"] = () => null;
// @ts-expect-error missing non-null title cannot be hidden as full WikiPage
const missingTitle: ModerationMutationResolvers["lockWikiPage"] = () => ({id:"w",slug:"w",channelUniqueName:"c",body:null,locked:false,lockedAt:null,lockReason:null,lockedByUsername:null});
// @ts-expect-error scalar pin result must be Boolean
const badPin: ModerationMutationResolvers["pinWikiPageToChannel"] = () => "true";
// @ts-expect-error sticky flag cannot be a string
const badSticky: StickyCommentResult = {id:"c",isSticky:"true",stickyAt:null,stickyByUsername:null};
const pin: WikiPinPage = {id:"w",Channel:null};
// @ts-expect-error lock query adds an explicitly selected nullable field
const wrongProjection: WikiLockPage = pin;
// @ts-expect-error unselected relationships do not exist on lock result
const unfetched = (page: WikiLockResult) => page.ChildPages;
// @ts-expect-error soft delete selected count must be numeric or null
const badCount: SoftDeletedComment = {id:"c",text:null,weightedVotesCount:"3",createdAt:"now",updatedAt:null};
// @ts-expect-error featured IDs cannot contain null entries
const badFeatured: ModerationMutationResolvers["setFeaturedWikiPages"] = () => ({serverName:"s",featuredWikiPageIds:[null]});
void [checked,nullable,missingTitle,badPin,badSticky,wrongProjection,unfetched,badCount,badFeatured];
