// Barrel for the ownership/authorship graphql-shield rules.
//
// Each rule previously lived in this file (it had grown to ~700 lines covering
// 12+ entity types). They now live one-per-file under ./ownership/; this barrel
// preserves the original `./permission/isOwner.js` import surface.
export { isChannelOwner } from "./ownership/isChannelOwner.js";
export { isDiscussionOwner } from "./ownership/isDiscussionOwner.js";
export { isEventOwner } from "./ownership/isEventOwner.js";
export { isCommentAuthor } from "./ownership/isCommentAuthor.js";
export { isAccountOwner } from "./ownership/isAccountOwner.js";
export { isCollectionOwner } from "./ownership/isCollectionOwner.js";
export { isAlbumOwner } from "./ownership/isAlbumOwner.js";
export { isDiscussionChannelOwner } from "./ownership/isDiscussionChannelOwner.js";
export { isImageUploader } from "./ownership/isImageUploader.js";
export { isIssueAuthor } from "./ownership/isIssueAuthor.js";
export { issueIsNotLocked } from "./ownership/issueIsNotLocked.js";
