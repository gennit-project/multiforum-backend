import type { Driver } from "neo4j-driver";
import { createDownloadReviewRepository, type DownloadReviewRepository } from "../../services/persistence/downloadReviewRepository.js";
import type {
  DownloadableFileUpdateInput,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  setUserDataOnContext,
  type AuthContextForUserLookup,
} from "../../rules/permission/userDataHelperFunctions.js";

type Input = { driver: Driver; downloadReviewRepository?: DownloadReviewRepository };

type FileRecord = {
  scanStatus?: string | null;
  uploadedByUsername?: string | null;
  Discussion?: { Author?: { username?: string | null } | null } | null;
};

type ReviewContext = GraphQLContext & AuthContextForUserLookup;

const requestDownloadableFileReview = ({ driver, downloadReviewRepository }: Input) => {
  const repository = downloadReviewRepository ?? createDownloadReviewRepository(driver);
  return async (
    _parent: unknown,
    args: { downloadableFileId: string; reason?: string | null },
    context: ReviewContext
  ) => {
    if (!context.user) {
      context.user = await setUserDataOnContext({ context });
    }
    const username = context.user?.username;
    if (!username) throw new Error("You must be logged in to request review");

    const files = await repository.findReviewAuthority(args.downloadableFileId) as FileRecord[];
    const file = files[0];
    if (!file) throw new Error("Downloadable file not found");

    const isCreator = file.uploadedByUsername === username ||
      file.Discussion?.Author?.username === username;
    if (!isCreator) throw new Error("Only the file creator can request review");
    if (file.scanStatus !== "SUSPICIOUS" && file.scanStatus !== "INFECTED") {
      throw new Error("Only held security scans can be sent for human review");
    }

    await repository.requestReview(args.downloadableFileId, ({
        reviewRequestedAt: new Date().toISOString(),
        reviewRequestReason: args.reason?.trim() || null,
        reviewRequestedByUsername: username,
      } as DownloadableFileUpdateInput));

    const updated = await repository.findRequested(args.downloadableFileId);
    return updated[0];
  };
};

export default requestDownloadableFileReview;
