import type { UserContributionItemSource, ChannelContributionItemSource } from './contributionItemSelections.js';
import type { QueryResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { SelectedResolver } from "./selection.js";
export const contributionReadQueryNames = ["getUserContributions","getModContributions","getChannelContributions","getSiteWideIssueList"] as const;
export type ContributionReadQueryResolvers = {
  getUserContributions: SelectedResolver<QueryResolvers<GraphQLContext>["getUserContributions"],{date:true;count:true;activities:{type:true}}> & UserContributionItemSource;
  getModContributions: SelectedResolver<QueryResolvers<GraphQLContext>["getModContributions"],{date:true;count:true}>;
  getChannelContributions: SelectedResolver<QueryResolvers<GraphQLContext>["getChannelContributions"],{totalContributions:true;dayData:{date:true;activities:{type:true}}}> & ChannelContributionItemSource;
  getSiteWideIssueList: SelectedResolver<QueryResolvers<GraphQLContext>["getSiteWideIssueList"],{aggregateIssueCount:true}>;
};
