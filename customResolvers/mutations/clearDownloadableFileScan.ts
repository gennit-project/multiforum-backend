import type { Driver } from "neo4j-driver";
import type {
  DownloadableFileModel,
  DownloadableFileUpdateInput,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";

type Input = {
  DownloadableFile: DownloadableFileModel;
  driver: Driver;
};

export const createClearDownloadableFileScanResolver = ({
  DownloadableFile,
  driver,
}: Input) => {
  return async (
    _parent: unknown,
    args: { downloadableFileId: string; reason?: string | null },
    context: GraphQLContext
  ) => {
    const files = await DownloadableFile.find({
      where: { id: args.downloadableFileId },
      selectionSet: `{ id scanStatus }`,
    });
    if (!files.length) throw new Error("Downloadable file not found");
    if (files[0].scanStatus === "CLEAN") {
      throw new Error("The downloadable file is already clean");
    }

    const reviewer =
      context.user?.data?.ModerationProfile?.displayName ||
      context.user?.username ||
      "a moderator";
    const explanation = args.reason?.trim();
    const scanReason = explanation
      ? `Cleared by ${reviewer}: ${explanation}`
      : `Cleared by ${reviewer} after human review`;
    const scanCheckedAt = new Date().toISOString();

    await DownloadableFile.update({
      where: { id: args.downloadableFileId },
      update: ({
        scanStatus: "CLEAN",
        scanReason,
        scanCheckedAt,
        reviewRequestedAt: null,
        reviewRequestReason: null,
        reviewRequestedByUsername: null,
      } as DownloadableFileUpdateInput),
    });

    const session = driver.session();
    try {
      await session.run(
        `
        MATCH (file:DownloadableFile {id: $downloadableFileId})
        MATCH (file)<-[:HAS_DOWNLOADABLE_FILE]-(discussion:Discussion)
        MATCH (author:User)-[:AUTHORED_DISCUSSION]->(discussion)
        CREATE (notification:Notification {
          id: randomUUID(),
          createdAt: datetime(),
          read: false,
          text: $notificationText,
          notificationType: 'moderation'
        })
        CREATE (author)-[:HAS_NOTIFICATION]->(notification)
        `,
        {
          downloadableFileId: args.downloadableFileId,
          notificationText: `Your downloadable file passed human security review and is now available. ${scanReason}`,
        }
      );
    } finally {
      await session.close();
    }

    const updated = await DownloadableFile.find({
      where: { id: args.downloadableFileId },
      selectionSet: `{ id fileName scanStatus scanReason scanCheckedAt }`,
    });
    return updated[0];
  };
};

export default createClearDownloadableFileScanResolver;
