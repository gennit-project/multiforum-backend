import {int} from 'neo4j-driver';
import type {DetailCore,DetailChannel,DetailFile} from '../../customResolvers/contracts/discussionDetailSources.js';
export const detailCoreFixture=():DetailCore=>({
 id:'discussion-1',title:'Hello',body:null,createdAt:null,updatedAt:null,hasDownload:null,hasSensitiveContent:null,
 Author:null,Album:null,Tags:[],FeedbackCommentsAggregate:{count:int(0)},FeedbackCommentsConnection:{totalCount:int(0),aggregate:{count:{nodes:int(0)}}},
 FeedbackComments:[],CrosspostedDiscussion:null,SharedCollection:null,isFavorited:null,
});
export const detailChannelFixture=():DetailChannel=>({
 id:'entry-1',discussionId:'discussion-1',channelUniqueName:'cats',weightedVotesCount:null,archived:null,answered:null,locked:null,emoji:null,
 Flairs:[],UpvotedByUsers:[],SuperUpvotedByUsers:[],UpvotedByUsersAggregate:{count:int(0)},UpvotedByUsersConnection:{totalCount:int(0),aggregate:{count:{nodes:int(0)}}},
 CommentsAggregate:{count:int(0)},CommentsConnection:{totalCount:int(0),aggregate:{count:{nodes:int(0)}}},Answers:[],_detailAnswersHasNextPage:false,LabelOptions:[],
 Discussion:{id:'discussion-1'},Channel:{uniqueName:'cats',channelIconURL:null,displayName:null,feedbackEnabled:null,imageUploadsEnabled:null,markdownImagesEnabled:null,emojiEnabled:null},
});
export const detailFileFixture=():DetailFile=>({
 id:'file-1',createdAt:null,fileName:null,url:null,kind:null,size:null,priceModel:null,priceCents:null,priceCurrency:null,downloadCountTotal:null,downloadCountUnique:null,
 attributionOverride:null,supportPatreonUrl:null,supportBuyMeACoffeeUrl:null,supportKoFiUrl:null,supportPayPalMeUrl:null,scanStatus:null,scanCheckedAt:null,scanReason:null,uploadedByUsername:null,license:null,
});
