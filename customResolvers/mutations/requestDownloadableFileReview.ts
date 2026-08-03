import type {
  DownloadableFileModel,
  DownloadableFileUpdateInput,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  setUserDataOnContext,
  type AuthContextForUserLookup,
} from "../../rules/permission/userDataHelperFunctions.js";

type Input = { DownloadableFile: DownloadableFileModel };

type FileRecord = {
  scanStatus?: string | null;
  uploadedByUsername?: string | null;
  Discussion?: { Author?: { username?: string | null } | null } | null;
};

type ReviewContext = GraphQLContext & AuthContextForUserLookup;

const requestDownloadableFileReview = ({ DownloadableFile }: Input) => {
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

    const files = await DownloadableFile.find({
      where: { id: args.downloadableFileId },
      selectionSet: `{
        scanStatus
        uploadedByUsername
        Discussion { Author { username } }
      }`,
    }) as FileRecord[];
    const file = files[0];
    if (!file) throw new Error("Downloadable file not found");

    const isCreator = file.uploadedByUsername === username ||
      file.Discussion?.Author?.username === username;
    if (!isCreator) throw new Error("Only the file creator can request review");
    if (file.scanStatus !== "SUSPICIOUS" && file.scanStatus !== "INFECTED") {
      throw new Error("Only held security scans can be sent for human review");
    }

    await DownloadableFile.update({
      where: { id: args.downloadableFileId },
      update: ({
        reviewRequestedAt: new Date().toISOString(),
        reviewRequestReason: args.reason?.trim() || null,
        reviewRequestedByUsername: username,
      } as DownloadableFileUpdateInput),
    });

    const updated = await DownloadableFile.find({
      where: { id: args.downloadableFileId },
      selectionSet: `{
        id fileName scanStatus scanReason scanCheckedAt
        reviewRequestedAt reviewRequestReason reviewRequestedByUsername
      }`,
    });
    return updated[0];
  };
};

export default requestDownloadableFileReview;
