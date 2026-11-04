import type {MutationResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from './selection.js';
export const moderationReportSelection={id:true,isOpen:true,flaggedServerRuleViolation:true} as const;
export const moderationReportMutationNames=["reportComment", "reportDiscussion", "reportEvent", "reportChannel", "reportImage", "reportProfilePicture", "reportChannelImage", "reportWikiEdit"] as const;
export type ModerationReportMutationResolvers={
 reportComment:SelectedResolver<MutationResolvers<GraphQLContext>['reportComment'],typeof moderationReportSelection>;
 reportDiscussion:SelectedResolver<MutationResolvers<GraphQLContext>['reportDiscussion'],typeof moderationReportSelection>;
 reportEvent:SelectedResolver<MutationResolvers<GraphQLContext>['reportEvent'],typeof moderationReportSelection>;
 reportChannel:SelectedResolver<MutationResolvers<GraphQLContext>['reportChannel'],typeof moderationReportSelection>;
 reportImage:SelectedResolver<MutationResolvers<GraphQLContext>['reportImage'],typeof moderationReportSelection>;
 reportProfilePicture:SelectedResolver<MutationResolvers<GraphQLContext>['reportProfilePicture'],typeof moderationReportSelection>;
 reportChannelImage:SelectedResolver<MutationResolvers<GraphQLContext>['reportChannelImage'],typeof moderationReportSelection>;
 reportWikiEdit:SelectedResolver<MutationResolvers<GraphQLContext>['reportWikiEdit'],typeof moderationReportSelection>;
};
