// Aggregates every graphql-shield rule into the `ruleList` consumed by
// permissions.ts. The rule *definitions* live in focused modules:
//   - permission/isOwner.js            ownership/authorship rules
//   - permission/*                     channel/server permission rules
//   - validation/*                     input validation rules
//   - definitions/*                    rules previously inlined in this file
// This file only wires them together and re-exports the handful of helpers and
// types that tests and validation modules import from "./rules".
import { isAuthenticatedAndVerified, isAuthenticated } from "./permission/userDataHelperFunctions.js";
import {
  isChannelOwner,
  isAccountOwner,
  isDiscussionOwner,
  isDiscussionChannelOwner,
  isEventOwner,
  isCommentAuthor,
  isCollectionOwner,
  isAlbumOwner,
  isImageUploader,
  isIssueAuthor,
  issueIsNotLocked,
} from "./permission/isOwner.js";
import { hasChannelPermission } from "./permission/hasChannelPermission.js";
import { canArchiveAndUnarchiveDiscussion } from "./permission/canArchiveAndUnarchiveDiscussion.js";
import { canArchiveAndUnarchiveEvent } from "./permission/canArchiveAndUnarchiveEvent.js";
import { canArchiveAndUnarchiveComment } from "./permission/canArchiveAndUnarchiveComment.js";
import { canArchiveAndUnarchiveImage } from "./permission/canArchiveAndUnarchiveImage.js";
import { canPermanentlyRemoveImage } from "./permission/canPermanentlyRemoveImage.js";
import { canEditComments } from "./permission/canEditComments.js";
import { canEditDiscussions } from "./permission/canEditDiscussions.js";
import { canEditEvents } from "./permission/canEditEvents.js";
import { canReport } from "./permission/canReport.js";
import { canSuspendAndUnsuspendUser } from "./permission/canSuspendAndUnsuspendUser.js";
import { canBecomeForumAdmin } from "./permission/canBecomeForumAdmin.js";
import { canLockChannel } from "./permission/canLockChannel.js";
import {
  createDiscussionInputIsValid,
  updateDiscussionInputIsValid,
} from "./validation/discussionIsValid.js";
import {
  createCommentInputIsValid,
  updateCommentInputIsValid,
} from "./validation/commentIsValid.js";
import {
  createEventInputIsValid,
  updateEventInputIsValid,
} from "./validation/eventIsValid.js";
import {
  createChannelInputIsValid,
  updateChannelInputIsValid,
} from "./validation/channelIsValid.js";
import {
  createDownloadableFileInputIsValid,
  updateDownloadableFileInputIsValid,
} from "./validation/downloadableFileIsValid.js";
import { updateUserInputIsValid } from "./validation/userIsValid.js";
import {
  serverRoleInputDoesNotEscalate,
  modServerRoleInputDoesNotEscalate,
} from "./validation/roleEscalation.js";
import {
  canCreateChannel,
  canCreateComment,
  canCreateDiscussion,
  canCreateEvent,
} from "./definitions/contentCreationRules.js";
import {
  canEditWikiPages,
  canDeleteWikiPages,
  canEditWikiHomePage,
} from "./definitions/wikiRules.js";
import { canUpvoteComment, canUpvoteDiscussion } from "./definitions/votingRules.js";
import {
  isRoot,
  canUploadFile,
  canGiveFeedback,
  canReportContent,
  canReportServerContent,
  issueIsValid,
  canManageServerSettings,
  canManagePlugins,
  canManageRoles,
  canManageMods,
  canManageAdmins,
  canManageSuperAdmins,
  canRemoveDiscussionChannel,
  canRemoveEventChannel,
} from "./definitions/serverRules.js";

// Re-exported for tests and the validation modules that import from "./rules".
export { evaluateCanCreateChannelRule } from "./definitions/contentCreationRules.js";
export type {
  CreateDiscussionItem,
  CanCreateDiscussionArgs,
  CanUpdateDiscussionArgs,
  SingleEventInput,
  CanCreateEventArgs,
} from "./definitions/contentCreationRules.js";
export {
  evaluateCanEditWikiPagesRule,
  evaluateCanEditWikiHomePageRule,
  evaluateCanDeleteWikiPagesRule,
} from "./definitions/wikiRules.js";

const ruleList = {
  isChannelOwner,
  isDiscussionOwner,
  isDiscussionChannelOwner,
  isEventOwner,
  isCommentAuthor,
  isIssueAuthor,
  issueIsNotLocked,
  isAuthenticatedAndVerified,
  isAuthenticated,
  issueIsValid,
  canCreateChannel,
  canCreateComment,
  canCreateDiscussion,
  canCreateEvent,
  createChannelInputIsValid,
  createCommentInputIsValid,
  updateChannelInputIsValid,
  updateCommentInputIsValid,
  createDiscussionInputIsValid,
  updateDiscussionInputIsValid,
  createEventInputIsValid,
  updateEventInputIsValid,
  createDownloadableFileInputIsValid,
  updateDownloadableFileInputIsValid,
  updateUserInputIsValid,
  serverRoleInputDoesNotEscalate,
  modServerRoleInputDoesNotEscalate,
  hasChannelPermission,
  isRoot,
  canManageServerSettings,
  canManagePlugins,
  canManageRoles,
  canManageMods,
  canManageAdmins,
  canManageSuperAdmins,
  canRemoveDiscussionChannel,
  canRemoveEventChannel,
  isAccountOwner,
  canUploadFile,
  canUpvoteComment,
  canUpvoteDiscussion,
  canGiveFeedback,
  canReportContent,
  canReportServerContent,
  canArchiveAndUnarchiveDiscussion,
  canArchiveAndUnarchiveEvent,
  canArchiveAndUnarchiveComment,
  canArchiveAndUnarchiveImage,
  canPermanentlyRemoveImage,
  canEditComments,
  canEditDiscussions,
  canEditEvents,
  canReport,
  canSuspendAndUnsuspendUser,
  canBecomeForumAdmin,
  canLockChannel,
  isCollectionOwner,
  isAlbumOwner,
  isImageUploader,
  canEditWikiPages,
  canDeleteWikiPages,
  canEditWikiHomePage,
};

export default ruleList;
