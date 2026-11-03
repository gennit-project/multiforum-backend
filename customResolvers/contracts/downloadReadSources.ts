import type { QueryResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { SelectedResolver } from "./selection.js";
// The username predicate and review-status filter prove these selected values.
// Nested discussion/file properties remain unknown and are completed lazily.
export const downloadReadSourceQueryNames = ["getUploadedDownloadableFiles", "getDownloadScanReviewQueue"] as const;
export type DownloadReadSourceQueryResolvers = {
  getUploadedDownloadableFiles: SelectedResolver<QueryResolvers<GraphQLContext>["getUploadedDownloadableFiles"], { files: { uploadedByUsername: true } }>;
  getDownloadScanReviewQueue: SelectedResolver<QueryResolvers<GraphQLContext>["getDownloadScanReviewQueue"], { scanStatus: true }>;
};
