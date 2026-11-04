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
// Ordinary discussion creation is fixed by #448, but its shared crosspost union
// and the event post-write read still need total-element proof.
import type { createDiscussionsFromInput } from "../../customResolvers/mutations/createDiscussionWithChannelConnections.js";
import type { createEventsFromInput } from "../../customResolvers/mutations/createEventWithChannelConnections.js";
import type { CreatedDiscussionProjection } from "../../customResolvers/contracts/contentProjections.js";
declare const discussions: Awaited<ReturnType<typeof createDiscussionsFromInput>>;
declare const events: Awaited<ReturnType<typeof createEventsFromInput>>;
// @ts-expect-error the shared helper still includes an unguarded crosspost response element
const totalDiscussions: CreatedDiscussionProjection[] = discussions;
// @ts-expect-error a missing post-write read can leave an undefined non-null list item
const totalEvents: CreatedEventProjection[] = events;
void [totalDiscussions,totalEvents];
