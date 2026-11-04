import type {ModerationArchiveMutationResolvers} from "../../customResolvers/contracts/moderationArchives.js";
import archiveComment from "../../customResolvers/mutations/archiveComment.js";
declare const archiveCommentResolver:ReturnType<typeof archiveComment>;
import unarchiveComment from "../../customResolvers/mutations/unarchiveComment.js";
declare const unarchiveCommentResolver:ReturnType<typeof unarchiveComment>;
import archiveDiscussion from "../../customResolvers/mutations/archiveDiscussion.js";
declare const archiveDiscussionResolver:ReturnType<typeof archiveDiscussion>;
import unarchiveDiscussion from "../../customResolvers/mutations/unarchiveDiscussion.js";
declare const unarchiveDiscussionResolver:ReturnType<typeof unarchiveDiscussion>;
import archiveEvent from "../../customResolvers/mutations/archiveEvent.js";
declare const archiveEventResolver:ReturnType<typeof archiveEvent>;
import unarchiveEvent from "../../customResolvers/mutations/unarchiveEvent.js";
declare const unarchiveEventResolver:ReturnType<typeof unarchiveEvent>;
import archiveImage from "../../customResolvers/mutations/archiveImage.js";
declare const archiveImageResolver:ReturnType<typeof archiveImage>;
import unarchiveImage from "../../customResolvers/mutations/unarchiveImage.js";
declare const unarchiveImageResolver:ReturnType<typeof unarchiveImage>;
const checked:ModerationArchiveMutationResolvers={archiveComment:archiveCommentResolver,unarchiveComment:unarchiveCommentResolver,archiveDiscussion:archiveDiscussionResolver,unarchiveDiscussion:unarchiveDiscussionResolver,archiveEvent:archiveEventResolver,unarchiveEvent:unarchiveEventResolver,archiveImage:archiveImageResolver,unarchiveImage:unarchiveImageResolver};
import type {OpenModerationIssueRow} from "../../services/persistence/moderationIssueWrites.js";
import type {ArchiveCommentSnapshot, ArchiveImageSnapshot} from "../../services/persistence/archiveProjections.js";
declare const row:OpenModerationIssueRow,comment:ArchiveCommentSnapshot,image:ArchiveImageSnapshot;
// @ts-expect-error persisted issueNumber remains unknown outside the checked subset
const issueNumber:number=row.issueNumber;
// @ts-expect-error unrelated persisted Issue body remains unknown
const body:string=row.body;
// @ts-expect-error snapshot does not fetch full Comment
const locked:boolean=comment.locked;
// @ts-expect-error snapshot does not fetch full Image
const width:number=image.width;
// @ts-expect-error generated non-null identity may not be omitted
const missingId:ModerationArchiveMutationResolvers['archiveComment']=async()=>({isOpen:false});
// @ts-expect-error generated open state must remain Boolean
const invalidOpen:ModerationArchiveMutationResolvers['unarchiveEvent']=async()=>({id:'i',isOpen:'false'});
void [checked,issueNumber,body,locked,width,missingId,invalidOpen];
