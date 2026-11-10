import type {RawSelectedResolver} from "./rawSelectedSource.js";
import type {DetailAnswerSelection,DetailFileSelection,DetailImageSelection} from "./discussionDetailSources.js";
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
// maps additionally have explicit raw source selections below; persisted scalar
// values still complete lazily through GraphQL.
export const contentPageSelection = {
  pageInfo: { endCursor: true, hasNextPage: true },
} as const satisfies Selection<DiscussionAnswerPage>;
export const contentPageQueryNames = [
  "getDiscussionDetailAnswers", "getDiscussionDetailFiles", "getDiscussionDetailImages", "getSiteWideDiscussionList",
] as const;
export type ContentPageQueryResolvers = {
  getDiscussionDetailAnswers: SelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetailAnswers"], typeof contentPageSelection> & RawSelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetailAnswers"],{answers:DetailAnswerSelection}>;
  getDiscussionDetailFiles: SelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetailFiles"], typeof contentPageSelection> & RawSelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetailFiles"],{files:DetailFileSelection}>;
  getDiscussionDetailImages: SelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetailImages"], typeof contentPageSelection> & RawSelectedResolver<QueryResolvers<GraphQLContext>["getDiscussionDetailImages"],{images:DetailImageSelection}>;
  getSiteWideDiscussionList: SelectedResolver<QueryResolvers<GraphQLContext>["getSiteWideDiscussionList"], typeof contentPageSelection>;
};
