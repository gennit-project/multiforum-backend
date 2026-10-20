import { GraphQLEnumType, GraphQLString } from "graphql";
import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type DownloadableFileAccess = {
  uploadedByUsername: string | null;
  discussionAuthorUsername: string | null;
};

export interface DownloadableFileRepository {
  findUrlAccess(id: string): Promise<DownloadableFileAccess | null>;
}

export const FIND_DOWNLOADABLE_FILE_URL_ACCESS_QUERY = `
  MATCH (file:DownloadableFile {id: $id})
  WHERE file.ageGateRestricted IS NULL OR file.ageGateRestricted = false
  RETURN file.scanStatus AS scanStatus,
         file.uploadedByUsername AS uploadedByUsername,
         head([
           (file)<-[:HAS_DOWNLOADABLE_FILE]-(discussion:Discussion)
           WHERE discussion.hasSensitiveContent IS NULL
              OR discussion.hasSensitiveContent = false |
           head([(discussion)<-[:POSTED_DISCUSSION]-(author:User) |
             author { .username }
           ])
         ]) AS author
  LIMIT 1
`;

// The old projection selected this non-null enum even though the permission
// decision did not use it. Retain its serialization errors rather than granting
// access to records that the generated GraphQL read previously rejected.
const scanStatusType = new GraphQLEnumType({
  name: "ScanStatus",
  values: {
    PENDING: {}, CLEAN: {}, INFECTED: {}, SUSPICIOUS: {}, FAILED: {},
  },
});

const nullableString = (value: unknown): string | null =>
  value == null ? null : GraphQLString.serialize(value);

export function createDownloadableFileRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): DownloadableFileRepository {
  return {
    async findUrlAccess(id) {
      const session = driver.session({
        database,
        defaultAccessMode: neo4j.session.READ,
        bookmarkManager: driver.executeQueryBookmarkManager,
      });
      try {
        // Preserve managed retries and the shared driver's request bookmarks.
        const result = await session.executeRead((tx) =>
          tx.run(FIND_DOWNLOADABLE_FILE_URL_ACCESS_QUERY, { id })
        );
        const record = result.records[0];
        if (!record) return null;
        const scanStatus: unknown = record.get("scanStatus");
        if (scanStatus == null) {
          throw new Error("Cannot return null for non-nullable field DownloadableFile.scanStatus.");
        }
        scanStatusType.serialize(scanStatus);
        const author = record.get("author") as { username?: unknown } | null;
        if (author && author.username == null) {
          throw new Error("Cannot return null for non-nullable field User.username.");
        }
        return {
          uploadedByUsername: nullableString(record.get("uploadedByUsername")),
          discussionAuthorUsername: nullableString(author?.username),
        };
      } finally {
        await session.close();
      }
    },
  };
}

export const resolveDownloadableFileRepository = (context: {
  driver: Driver;
  downloadableFileRepository?: DownloadableFileRepository;
}): DownloadableFileRepository =>
  context.downloadableFileRepository ??
  createDownloadableFileRepository(context.driver);
