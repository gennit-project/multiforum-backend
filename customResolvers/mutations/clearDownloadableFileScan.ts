import { createDownloadReviewRepository, type DownloadReviewRepository } from "../../services/persistence/downloadReviewRepository.js";
import type { Driver } from "neo4j-driver";
import type {
  DownloadableFileUpdateInput,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";

type Input = {
  downloadReviewRepository?: DownloadReviewRepository;
  driver: Driver;
};

export const createClearDownloadableFileScanResolver = ({
  downloadReviewRepository,
  driver,
}: Input) => {
  const repository = downloadReviewRepository ?? createDownloadReviewRepository(driver);
  return async (
    _parent: unknown,
    args: { downloadableFileId: string; reason?: string | null },
    context: GraphQLContext
  ) => {
    const files = await repository.findReleaseStatus(args.downloadableFileId);
    if (!files.length) throw new Error("Downloadable file not found");
    if (files[0].scanStatus === "CLEAN") {
      throw new Error("The downloadable file is already clean");
    }

    const explanation = args.reason?.trim();
    if (!explanation) {
      throw new Error("A review reason is required to release quarantine");
    }

    const reviewer =
      context.user?.data?.ModerationProfile?.displayName ||
      context.user?.username ||
      "a moderator";
    const scanReason = `Cleared by ${reviewer}: ${explanation}`;
    const scanCheckedAt = new Date().toISOString();

    await repository.clearScan(args.downloadableFileId, ({
        scanStatus: "CLEAN",
        scanReason,
        scanCheckedAt,
        reviewRequestedAt: null,
        reviewRequestReason: null,
        reviewRequestedByUsername: null,
      } as DownloadableFileUpdateInput));

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

    const updated = await repository.findCleared(args.downloadableFileId);
    return updated[0];
  };
};

export default createClearDownloadableFileScanResolver;
