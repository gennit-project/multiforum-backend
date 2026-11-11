import type { MutationResolvers, Issue } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { Selection, SelectedResolver } from "./selection.js";
export const archivedIssueSelection={id:true,isOpen:true} as const satisfies Selection<Issue>;
export const moderationArchiveMutationNames=['archiveComment','unarchiveComment','archiveDiscussion','unarchiveDiscussion','archiveEvent','unarchiveEvent','archiveImage','unarchiveImage'] as const;
export type ModerationArchiveMutationResolvers={
 archiveComment:SelectedResolver<MutationResolvers<GraphQLContext>["archiveComment"],typeof archivedIssueSelection>;
 unarchiveComment:SelectedResolver<MutationResolvers<GraphQLContext>["unarchiveComment"],typeof archivedIssueSelection>;
 archiveDiscussion:SelectedResolver<MutationResolvers<GraphQLContext>["archiveDiscussion"],typeof archivedIssueSelection>;
 unarchiveDiscussion:SelectedResolver<MutationResolvers<GraphQLContext>["unarchiveDiscussion"],typeof archivedIssueSelection>;
 archiveEvent:SelectedResolver<MutationResolvers<GraphQLContext>["archiveEvent"],typeof archivedIssueSelection>;
 unarchiveEvent:SelectedResolver<MutationResolvers<GraphQLContext>["unarchiveEvent"],typeof archivedIssueSelection>;
 archiveImage:SelectedResolver<MutationResolvers<GraphQLContext>["archiveImage"],typeof archivedIssueSelection>;
 unarchiveImage:SelectedResolver<MutationResolvers<GraphQLContext>["unarchiveImage"],typeof archivedIssueSelection>;
};
