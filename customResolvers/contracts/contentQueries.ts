import type { QueryResolvers, DiscussionAnswerPage } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";

// These three roots compute scalar results. Unlike selected entity contracts,
// their complete public result types can be checked against existing codegen.
export const contentScalarQueryNames = [
  "getUserFavoriteComment", "getUserWikiEditsCount", "isOriginalPosterSuspended",
] as const;
export type ContentScalarQueryName = typeof contentScalarQueryNames[number];
export type ContentScalarQueryResolvers = {
  [Name in ContentScalarQueryName]: NonNullable<QueryResolvers<GraphQLContext>[Name]>;
};

// Only these computed pagination fields are certified here. Raw Cypher item
// maps still need their own projection migration; see the query audit.
export const contentPageSelection = {
  pageInfo: { endCursor: true, hasNextPage: true },
} as const satisfies Selection<DiscussionAnswerPage>;
export const contentPageQueryNames = [
  "getDiscussionDetailAnswers", "getDiscussionDetailFiles", "getDiscussionDetailImages", "getSiteWideDiscussionList",
] as const;
export type ContentPageQueryResolvers = {
  getDiscussionDetailAnswers: SelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetailAnswers"], typeof contentPageSelection>;
  getDiscussionDetailFiles: SelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetailFiles"], typeof contentPageSelection>;
  getDiscussionDetailImages: SelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetailImages"], typeof contentPageSelection>;
  getSiteWideDiscussionList: SelectedResolver<QueryResolvers<GraphQLContext>["getSiteWideDiscussionList"], typeof contentPageSelection>;
};
