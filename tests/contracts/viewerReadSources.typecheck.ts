import type { Driver } from "neo4j-driver";
import type { ViewerReadQueryResolvers } from "../../customResolvers/contracts/viewerReadSources.js";
import type { ViewerComment, DiscussionViewerCore } from "../../customResolvers/contracts/viewerReadProjections.js";
import replies from "../../customResolvers/queries/getCommentReplies.js";
import section from "../../customResolvers/queries/getCommentSection.js";
import events from "../../customResolvers/queries/getEventComments.js";
import detail from "../../customResolvers/queries/getDiscussionDetail.js";
import discussions from "../../customResolvers/queries/getDiscussionsInChannel.js";
import channels from "../../customResolvers/queries/getSortedChannels.js";
declare const driver: Driver;
const checked = {
  getCommentReplies: replies({driver}), getCommentSection: section({driver}),
  getEventComments: events({driver}), getDiscussionDetail: detail({driver}),
  getDiscussionsInChannel: discussions({driver}), getSortedChannels: channels({driver}),
} satisfies ViewerReadQueryResolvers;
declare const rawComment: ViewerComment;
// @ts-expect-error arbitrary persisted comment text has not been proven
const text: string = rawComment.text;
// @ts-expect-error computed favorites cannot be arbitrary database values
const invalidFavorite: ViewerReadQueryResolvers["getSortedChannels"] = () => ({channels:[{isFavorited:"yes"}]});
// @ts-expect-error viewer identity requires a string from the matched request parameter
const invalidSubscriber: ViewerComment = {...rawComment,SubscribedToNotifications:[{username:null}]};
// @ts-expect-error parameter-matched discussion identity cannot be omitted
const invalidDiscussion: DiscussionViewerCore = {isFavorited:null};
// @ts-expect-error raw properties cannot replace the selected reply fields
const invalidReplies: ViewerReadQueryResolvers["getCommentReplies"] = () => ({ChildComments:[{}],aggregateChildCommentCount:0});
void [checked,text,invalidFavorite,invalidSubscriber,invalidDiscussion,invalidReplies];

declare const listSource: import('../../customResolvers/contracts/viewerReadProjections.js').DiscussionListViewerChannel;
const viewerName: string | undefined = listSource.UpvotedByUsers[0]?.username;
// @ts-expect-error a persisted author's identity is not the validated viewer parameter
const persistedAuthorName: string = listSource.Discussion.Author!.username;
// @ts-expect-error raw persisted title is intentionally not a proven GraphQL String
const persistedTitle: string = listSource.Discussion.title;
// @ts-expect-error the exact hydration projection has no arbitrary source properties
const absentProperty = listSource.unselected;
// @ts-expect-error a count's database source is a Neo4j integer, not serialized GraphQL output
const serializedCount: number = listSource.CommentsAggregate.count;
void [viewerName, persistedAuthorName, persistedTitle, absentProperty, serializedCount];

declare const commentSource: import('../../customResolvers/contracts/customCommentSources.js').CustomRootComment;
// @ts-expect-error fixed comment sources do not allow undeclared persisted fields
const arbitraryCommentProperty=commentSource.unselected;
// @ts-expect-error computed union provenance is restricted to the two actual schema members
const invalidSourceAuthor: import('../../customResolvers/contracts/customCommentSources.js').CustomCommentAuthorIdentity={username:null,displayName:null,__sourceAuthorType:'Channel'};
// @ts-expect-error arbitrary stored voter names are not validated viewer identities
const arbitraryVoter:string=commentSource.SuperUpvotedByUsers[0]!.username;
void [arbitraryCommentProperty,invalidSourceAuthor,arbitraryVoter];

declare const sortedSource:import('../../customResolvers/contracts/viewerReadProjections.js').SortedViewerChannel;
// @ts-expect-error tags require their explicitly selected raw text property
const missingTag:typeof sortedSource={...sortedSource,Tags:[{}]};
// @ts-expect-error a computed connection count is a native database integer
const wrongCount:typeof sortedSource={...sortedSource,EventChannelsConnection:{totalCount:1,aggregate:{count:{nodes:1}}}};
// @ts-expect-error stored channel names have not been proven as response strings
const unvalidatedName:string=sortedSource.uniqueName;
// @ts-expect-error the exact fixed source cannot claim unprojected account lists
const unselectedAdmins=sortedSource.Admins;
// @ts-expect-error the actual registered root must preserve its tag item source shape
const invalidSortedResult:ViewerReadQueryResolvers['getSortedChannels']=()=>({aggregateChannelCount:0,channels:[{...sortedSource,Tags:[{}]}]});
void [missingTag,wrongCount,unvalidatedName,unselectedAdmins,invalidSortedResult];
