/** Exact getEventCommentsMetadataQuery projection. Only predicate-matched
 * identities are narrowed; persisted scalar and native point values stay raw. */
export type EventMetadataSource={
 id:string;title:unknown;description:unknown;startTime:unknown;endTime:unknown;locationName:unknown;address:unknown;
 virtualEventUrl:unknown;startTimeDayOfWeek:unknown;startTimeHourOfDay:unknown;canceled:unknown;isHostedByOP:unknown;isAllDay:unknown;
 coverImageURL:unknown;createdAt:unknown;updatedAt:unknown;isInPrivateResidence:unknown;location:unknown;cost:unknown;
 Tags:{text:unknown}[];
 EventChannels:{id:unknown;eventId:unknown;channelUniqueName:unknown;Channel:{uniqueName:unknown;displayName:unknown;channelIconURL:unknown}|null}[];
 SubscribedToNotifications:{username:string}[];SubscribedToEventUpdates:{username:string}[];
 Poster:{username:unknown;createdAt:unknown;discussionKarma:unknown;commentKarma:unknown}|null;
};
/** Native Point conversion remains owned by Neo4j's field resolver. */
export type EventMetadataSelection={
 id:true;title:true;description:true;startTime:true;endTime:true;locationName:true;address:true;
 virtualEventUrl:true;startTimeDayOfWeek:true;startTimeHourOfDay:true;canceled:true;isHostedByOP:true;isAllDay:true;
 coverImageURL:true;createdAt:true;updatedAt:true;isInPrivateResidence:true;cost:true;
 Tags:{text:true};EventChannels:{id:true;eventId:true;channelUniqueName:true;Channel:{uniqueName:true;displayName:true;channelIconURL:true}};
 SubscribedToNotifications:{username:true};SubscribedToEventUpdates:{username:true};
 Poster:{username:true;createdAt:true;discussionKarma:true;commentKarma:true};
};
