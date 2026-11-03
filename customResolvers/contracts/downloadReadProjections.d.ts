/** Raw Cypher projections, not fully serialized GraphQL entities. Property reads
 * stay unknown; only expressions and WHERE-constrained values are narrowed. */
export type UploadedFileSource = Record<string, unknown> & {
  uploadedByUsername: string;
  createdAt: string | null;
  uploadedAt: string | null;
  permanentlyRemovedAt: string | null;
};
export type UploadedGroupRow = {
  group: {
    discussion: {
      id: unknown;
      title: unknown;
      createdAt: string | null;
      updatedAt: string | null;
      channelUniqueNames: unknown[];
    };
    files: UploadedFileSource[];
  };
};
export type DownloadReviewRow = {
  review: {
    downloadableFileId: unknown;
    fileName: unknown;
    scanStatus: "SUSPICIOUS" | "INFECTED" | "FAILED";
    scanReason: unknown;
    scanCheckedAt: string | null;
    reviewRequestedAt: string | null;
    reviewRequestReason: unknown;
    uploaderUsername: unknown;
    discussionId: unknown;
    discussionTitle: unknown;
    channelUniqueName: unknown;
  };
};
