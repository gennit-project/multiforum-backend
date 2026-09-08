import type { Driver } from "neo4j-driver";
import type { ServerConfigModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";

type Input = { driver: Driver; ServerConfig?: ServerConfigModel };

const getDownloadScanReviewQueue = ({ driver, ServerConfig }: Input) => {
  return async (_parent: unknown, args: { limit?: number | null } = {}, context: GraphQLContext) => {
    const canViewSensitiveContent = await mayAccessSensitiveContent({ context, driver, ServerConfig });
    const limit = Math.min(Math.max(args.limit || 50, 1), 100);
    const session = driver.session();
    try {
      const result = await session.run(
        `
        MATCH (discussion:Discussion)-[:HAS_DOWNLOADABLE_FILE]->(file:DownloadableFile)
        WHERE file.scanStatus IN ['SUSPICIOUS', 'INFECTED', 'FAILED']
          AND coalesce(file.permanentlyRemoved, false) = false
          AND ($mayAccessSensitiveContent OR coalesce(discussion.hasSensitiveContent, false) = false)
        OPTIONAL MATCH (author:User)-[:AUTHORED_DISCUSSION]->(discussion)
        OPTIONAL MATCH (discussion)<-[:POSTED_IN_CHANNEL]-(dc:DiscussionChannel)
        WITH file, discussion, author, head(collect(dc.channelUniqueName)) AS channelUniqueName
        ORDER BY
          CASE WHEN file.reviewRequestedAt IS NULL THEN 1 ELSE 0 END,
          file.reviewRequestedAt DESC,
          CASE file.scanStatus
            WHEN 'INFECTED' THEN 0
            WHEN 'SUSPICIOUS' THEN 1
            ELSE 2
          END,
          file.scanCheckedAt DESC
        LIMIT toInteger($limit)
        RETURN {
          downloadableFileId: file.id,
          fileName: file.fileName,
          scanStatus: file.scanStatus,
          scanReason: file.scanReason,
          scanCheckedAt: toString(file.scanCheckedAt),
          reviewRequestedAt: toString(file.reviewRequestedAt),
          reviewRequestReason: file.reviewRequestReason,
          uploaderUsername: coalesce(file.uploadedByUsername, author.username),
          discussionId: discussion.id,
          discussionTitle: discussion.title,
          channelUniqueName: channelUniqueName
        } AS review
        `,
        { limit, mayAccessSensitiveContent: canViewSensitiveContent }
      );
      return result.records.map((record) => record.get("review"));
    } finally {
      await session.close();
    }
  };
};

export default getDownloadScanReviewQueue;
