import type { MutationResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { SelectedResolver } from "./selection.js";
export const createdDownloadSelection = { downloadableFiles: { id: true }, info: { nodesCreated: true, relationshipsCreated: true } } as const;
export const removedDownloadSelection = { id: true, permanentlyRemoved: true, permanentlyRemovedAt: true, permanentlyRemovedByUsername: true, permanentlyRemovedByModName: true } as const;
export const downloadWriteMutationNames = ["createDownloadableFiles", "permanentlyDeleteDownloadableFile"] as const;
export type DownloadWriteMutationResolvers = {
  createDownloadableFiles: SelectedResolver<MutationResolvers<GraphQLContext>["createDownloadableFiles"], typeof createdDownloadSelection>;
  permanentlyDeleteDownloadableFile: SelectedResolver<MutationResolvers<GraphQLContext>["permanentlyDeleteDownloadableFile"], typeof removedDownloadSelection>;
};
