import createDiscussion from "../../customResolvers/mutations/createDiscussionWithChannelConnections.js";
import createEvent from "../../customResolvers/mutations/createEventWithChannelConnections.js";
import updateDiscussion from "../../customResolvers/mutations/updateDiscussionWithChannelConnections.js";
import updateEvent from "../../customResolvers/mutations/updateEventWithChannelConnections.js";
import updateOccurrence from "../../customResolvers/mutations/updateEventInSeries.js";
// Compile-only: actual factories as well as negative signatures are checked.
import type { Driver } from "neo4j-driver";
import type { ContentMutationResolvers, RevisionProjection, OwnedCommentProjection } from "../../customResolvers/contracts/content.js";
import type { CreatedEventProjection } from "../../customResolvers/contracts/contentProjections.js";
import createSeries from "../../customResolvers/mutations/createEventSeriesWithChannelConnections.js";
import deleteOccurrence from "../../customResolvers/mutations/deleteEventInSeries.js";
import createComment from "../../customResolvers/mutations/createCommentWithOwnedConnections.js";
import createIssue from "../../customResolvers/mutations/createIssue.js";
import { writeWikiPage, setWikiHomePage } from "../../customResolvers/mutations/writeWikiPage.js";
import { addImageToAlbum, removeImageFromAlbum } from "../../customResolvers/mutations/albumImageReuse.js";
import redact from "../../customResolvers/mutations/redactTextVersionRevision.js";
declare const driver: Driver;
const checked = {
 createDiscussionWithChannelConnections: createDiscussion({driver}),
 createEventWithChannelConnections: createEvent({driver}),
 updateDiscussionWithChannelConnections: updateDiscussion({driver}),
 updateEventWithChannelConnections: updateEvent({driver}),
 updateEventInSeries: updateOccurrence({driver}),
 createEventSeriesWithChannelConnections: createSeries({driver}),
 deleteEventInSeries: deleteOccurrence({driver}),
 createCommentWithOwnedConnections: createComment({driver}),
 createIssue: createIssue({driver}),
 writeWikiPage: writeWikiPage({driver}), setWikiHomePage: setWikiHomePage({driver}),
 addImageToAlbum: addImageToAlbum({driver}), removeImageFromAlbum: removeImageFromAlbum({driver}),
 deleteCommentRevision: redact({driver,revisionType:"comment"}),
 deleteDiscussionBodyRevision: redact({driver,revisionType:"discussion body"}),
 deleteEventDescriptionRevision: redact({driver,revisionType:"event description"}),
 deleteWikiRevision: redact({driver,revisionType:"wiki"}),
} satisfies ContentMutationResolvers;
// @ts-expect-error scalar result must be Boolean
const invalidAlbum: ContentMutationResolvers["addImageToAlbum"] = async () => "yes";
// @ts-expect-error selected revision body must be string/null, not an object
const invalidRevision: ContentMutationResolvers["deleteCommentRevision"] = async () => ({id:"v",body:{},editReason:null,createdAt:"",updatedAt:null,Author:null});
// @ts-expect-error issue number is a selected required number
const invalidIssue: ContentMutationResolvers["createIssue"] = async () => ({id:"i",issueNumber:"1"});
// @ts-expect-error selected event title is required
const missingEvent: CreatedEventProjection = {id:"e"};
declare const comment: OwnedCommentProjection;
// @ts-expect-error unfetched comment relationships are not full entities
comment.CommentAuthor;
declare const revision: RevisionProjection;
// @ts-expect-error nested author projection does not fetch karma
revision.Author?.commentKarma;
void [checked,invalidAlbum,invalidRevision,invalidIssue,missingEvent];
// Both creation paths now return only guarded successful elements.
import type { createDiscussionsFromInput } from "../../customResolvers/mutations/createDiscussionWithChannelConnections.js";
import type { createEventsFromInput } from "../../customResolvers/mutations/createEventWithChannelConnections.js";
import type { CreatedDiscussionProjection } from "../../customResolvers/contracts/contentProjections.js";
declare const discussions: Awaited<ReturnType<typeof createDiscussionsFromInput>>;
declare const events: Awaited<ReturnType<typeof createEventsFromInput>>;
const totalDiscussions: CreatedDiscussionProjection[] = discussions;
const totalEvents: CreatedEventProjection[] = events;
void [totalDiscussions,totalEvents];

// @ts-expect-error successful event responses require selected id and nested fields
const brokenEvent: ContentMutationResolvers["createEventWithChannelConnections"] = async () => [{title:"incomplete"}];
void brokenEvent;

// @ts-expect-error successful discussions require all selected response fields
const brokenDiscussion: ContentMutationResolvers["createDiscussionWithChannelConnections"] = async () => [{id:"missing-fields"}];
void brokenDiscussion;

import type { CrosspostIdentityProjection } from "../../customResolvers/contracts/contentProjections.js";
declare const crosspostIdentity: CrosspostIdentityProjection;
// @ts-expect-error the ID-only create document does not fetch title
crosspostIdentity.title;
// @ts-expect-error generated identity is a string
const invalidCrosspostIdentity: CrosspostIdentityProjection = {id:123};
void invalidCrosspostIdentity;

import type { AttachedDiscussionFilesProjection } from "../../customResolvers/contracts/contentProjections.js";
declare const attachments: AttachedDiscussionFilesProjection;
// @ts-expect-error attachment lookup does not fetch file URLs
attachments.DownloadableFiles[0].url;
